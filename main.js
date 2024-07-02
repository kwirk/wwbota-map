import './style.css';
import 'ol-layerswitcher/dist/ol-layerswitcher.css';

import {
  Collection, Feature, Map, View,
} from 'ol';
import LayerGroup from 'ol/layer/Group';
import ImageLayer from 'ol/layer/Image';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import BingMaps from 'ol/source/BingMaps';
import VectorSource from 'ol/source/Vector';
import OSM from 'ol/source/OSM';
import RasterSource from 'ol/source/Raster';
import XYZ from 'ol/source/XYZ';
import {bbox as bboxStrategy} from 'ol/loadingstrategy';
import {fromLonLat, transformExtent} from 'ol/proj';
import {buffer} from 'ol/extent';
import {GeoJSON} from 'ol/format';
import {
  Circle as CircleStyle,
  Fill,
  Stroke,
  Style,
  Text,
} from 'ol/style';
import Polygon, {circular} from 'ol/geom/Polygon';
import Point from 'ol/geom/Point';
import {
  Attribution,
  Control,
  Rotate,
  ScaleLine,
  Zoom,
} from 'ol/control';
import Link from 'ol/interaction/Link';
import LayerSwitcher from 'ol-layerswitcher';
import { LRUCache } from 'lru-cache';

import WWBOTA from './data/WWBOTA.json?url';
import COUNTRIES from './data/countries.json?url';

class GeoJSONReference extends GeoJSON {
  readFeatureFromObject(object, options) {
    const feature = super.readFeatureFromObject(object, options);
    feature.setId(feature.get('reference'));
    return feature;
  }
}

function getMaidenheadGrid(lon, lat, level) {
  let xg = (lon + 180) / 20;
  let yg = (lat + 90) / 10;
  let grid = String.fromCharCode(65 + Math.floor(xg));
  grid += String.fromCharCode(65 + Math.floor(yg));
  for (let n = 1; n < level; n += 1) {
    xg %= 1;
    yg %= 1;
    if (n % 2) {
      xg *= 10;
      yg *= 10;
      grid += Math.floor(xg).toString();
      grid += Math.floor(yg).toString();
    } else {
      xg *= 24;
      yg *= 24;
      grid += String.fromCharCode(65 + Math.floor(xg));
      grid += String.fromCharCode(65 + Math.floor(yg));
    }
  }
  return grid;
}

function getMaidenheadGridFeatures(extent, level) {
  const features = [];
  const newExtent = transformExtent(extent, 'EPSG:3857', 'EPSG:4326');
  let step = 10;
  for (let n = 1; n < level; n += 1) {
    step /= (n % 2) ? 10 : 24;
  }
  const x0 = Math.floor(newExtent[0] / (2 * step)) * (2 * step);
  const y0 = Math.floor(newExtent[1] / step) * step;
  const xN = Math.ceil(newExtent[2] / (2 * step)) * (2 * step);
  const yN = Math.ceil(newExtent[3] / step) * step;
  for (let x = x0; x < xN; x += 2 * step) {
    for (let y = y0; y < yN; y += step) {
      const grid = getMaidenheadGrid(x + (level * 1e-3), y + (level * 1e-3), level);
      const feature = new Feature({
        geometry: new Polygon(
          [[[x, y],
            [x + (2 * step), y],
            [x + (2 * step), y + step],
            [x, y + step],
            [x, y]]],
        ).transform('EPSG:4326', 'EPSG:3857'),
      });
      feature.setId(grid);
      features.push(feature);
    }
  }
  return features;
}

const COLOURS = {
  UKBOTA: 'rgba(122, 174, 0, 1)',
  ONBOTA: 'rgba(244, 197, 36, 1)',
  OKBOTA: 'rgba(13, 71, 160, 1)',
}

const COUNTRY_SCHEME = {
  GBR: 'UKBOTA',
  IMN: 'UKBOTA',
  JEY: 'UKBOTA',
  GGY: 'UKBOTA',
  BEL: 'ONBOTA',
  CZE: 'OKBOTA',
}

// Styles
function gridStyle(feature) {
  return new Style({
    stroke: new Stroke({
      color: 'rgba(100, 100, 100, 0.2)',
      width: 3,
    }),
    text: new Text({
      text: feature.getId(),
      font: 'bold 30px ui-rounded',
      stroke: new Stroke({color: 'rgba(100, 100, 100, 0.5)', width: 2}),
      fill: null,
    }),
  });
}

function createTextStyle(feature, resolution, text, color, offset = 15) {
  return new Text({
    text: text,
    font: 'bold ui-rounded',
    textAlign: 'center',
    fill: new Fill({color: '#000000'}),
    stroke: new Stroke({color: color, width: 1}),
    offsetY: offset,
    overflow: true,
  });
}

function colorOpacity(color, opacity = 0.2) {
  return color.replace(/[\d.]+\)$/g, `${opacity})`);
}

const circleImageStyleCache = new LRUCache({max: 32});

function pointStyleFunction(feature, resolution, color, radius) {
  let text = feature.get('reference');
  if (resolution < 40) {
    text += ` ${feature.get('name')}`;
  }
  let circleRadius = 5;
  let circleColor = color;
  let textOffset = 15;
  if (radius && radius > circleRadius) {
    circleRadius = radius;
    circleColor = colorOpacity(color);
    textOffset = 1.5;
  }

  let circleImageStyle = circleImageStyleCache.get(`${circleRadius}${circleColor}`);
  if (circleImageStyle === undefined) {
    circleImageStyle = new CircleStyle({
      radius: circleRadius,
      fill: new Fill({color: circleColor}),
      stroke: new Stroke({color: '#000000', width: 1}),
    });
    circleImageStyleCache.set(`${circleRadius}${circleColor}`, circleImageStyle);
  }

  return new Style({
    image: circleImageStyle,
    text: resolution < 350 ? createTextStyle(feature, resolution, text, color, textOffset) : undefined,
  });
}

function polygonStyleFunction(feature, resolution, text, color, bStroke = false, stroke = true) {
  return new Style({
    stroke: stroke ? new Stroke({
      color: bStroke ? '#000000' : color,
      width: bStroke ? 1 : 3,
    }) : undefined,
    fill: new Fill({
      color: colorOpacity(color, stroke ? 0.2 : 0.5),
    }),
    text: text ? createTextStyle(feature, resolution, text, color, 0) : undefined,
  });
}

const OSMSource = new OSM({
  attributions: 'Map:&nbsp;©<a href="https://openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>&nbsp;contributors.',
});

const bingGroup = new LayerGroup({
 title: 'Bing Imagery',
 shortTitle: 'BING',
 type: 'base',
 combine: true,
 visible: false,
 layers: [],
});

bingGroup.once('change:visible', () => {
 // Callback to only set layer when used
 // to avoid using API credits unnecessarily
 bingGroup.getLayers().push(new TileLayer({
   source: new BingMaps({
     key: import.meta.env.VITE_BING_APIKEY,
     imagerySet: 'Aerial',
     maxZoom: 19,
   }),
 }));
});

// Used for layers switching between Circle and Polygon styles
const dataCache = {};
function withData(url, func, error) {
  if (dataCache[url] !== undefined) {
    func(dataCache[url]);
  } else {
    const xhr = new XMLHttpRequest();
    xhr.responseType = 'json';
    xhr.open('GET', url);
    xhr.onerror = error;
    xhr.onload = () => {
      if (xhr.status === 200) {
        dataCache[url] = new GeoJSONReference(
        ).readFeaturesFromObject(xhr.response, {
          dataProjection: 'EPSG:4326',
          featureProjection: 'EPSG:3857',
        })
        func(dataCache[url]);
      } else {
        error();
      }
    };
    xhr.send();
  }
}

const map = new Map({
  target: 'map',
  controls: [new Zoom(), new Rotate(), new ScaleLine()],
  view: new View({
    center: fromLonLat([2, 53], 'EPSG:3857'),
    zoom: 5,
    maxZoom: 20,
  }),
  layers: [
    new LayerGroup({
      title: 'Base maps',
      layers: [
        new ImageLayer({
          title: 'OSM (Greyscale)',
          shortTitle: 'OSMG',
          type: 'base',
          source: new RasterSource({
            sources: [OSMSource],
            operation: (pixels) => {
              const pixel = pixels[0];

              const r = pixel[0];
              const g = pixel[1];
              const b = pixel[2];

              const v = 0.2126 * r + 0.7152 * g + 0.0722 * b;

              pixel[0] = v; // Red
              pixel[1] = v; // Green
              pixel[2] = v; // Blue

              return pixel;
            },
          }),
        }),
        new TileLayer({
          title: 'OSM',
          shortTitle: 'OSM',
          type: 'base',
          visible: false,
          source: OSMSource,
        }),
        new TileLayer({
          title: 'OpenTopoMap',
          shortTitle: 'OTM',
          type: 'base',
          visible: false,
          source: new XYZ({
            attributions: 'Map&nbsp;data:&nbsp;©<a href="https://openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>&nbsp;contributors,&nbsp;SRTM. '
              + 'Map&nbsp;display:&nbsp;©<a href="http://opentopomap.org" target="_blank">OpenTopoMap</a>&nbsp;(<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank">CC-BY-SA</a>).',
            url: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png',
          }),
        }),
        bingGroup,
      ],
    }),
    new VectorLayer({
      maxZoom: 8,
      style: (feature, resolution) => polygonStyleFunction(feature, resolution, null, COLOURS[COUNTRY_SCHEME[feature.get('ISO_A3')]], true),
      source: new VectorSource({
        format: new GeoJSON(),
        url: COUNTRIES,
      }),
    }),
    new LayerGroup({
      title: 'Overlays',
      layers: [
        new LayerGroup({
          title: 'Maidenhead Grid',
          shortTitle: 'MHG',
          visible: false,
          combine: true,
          layers: [[0, 6], [6, 10], [10, 20]].map((zoom, level) => new VectorLayer({
            minZoom: zoom[0],
            maxZoom: zoom[1],
            style: (feature) => new Style({
              stroke: new Stroke({
                color: 'rgba(255, 100, 100, 0.2)',
                width: 3,
              }),
              text: new Text({
                text: feature.getId(),
                font: 'bold 25px ui-rounded',
                stroke: new Stroke({color: 'rgba(255, 100, 100, 0.5)', width: 2}),
                fill: null,
              }),
            }),
            source: new VectorSource({
              overlaps: false,
              strategy: bboxStrategy,
              loader: function loader(extent, resolution, projection, success) {
                const features = getMaidenheadGridFeatures(extent, level + 1);
                this.addFeatures(features);
                success(features);
              },
            }),
          })),
        }),
      ],
    }),
    new LayerGroup({
      layers: [
        new LayerGroup({
          combine: true,
          visible: true,
          minZoom: 8,
          layers: [
            new VectorLayer({
              maxZoom: 11,
              updateWhileInteracting: true,
              updateWhileAnimating: true,
              style: (feature, resolution) => pointStyleFunction(feature, resolution, COLOURS[feature.get('scheme')], 1000 / resolution),
              source: new VectorSource({
                attributions: 'BOTA&nbsp;references:<a href="https://wwbota.org/" target="_blank">©&nbsp;Bunkers&nbsp;on&nbsp;the&nbsp;Air</a>.',
                loader: function loader(extent, resolution, projection, success, failure) {
                  const vectorSource = this;
                  withData(
                    WWBOTA,
                    (WWBOTAfeatures) => {
                      vectorSource.addFeatures(WWBOTAfeatures);
                      success(WWBOTAfeatures);
                    },
                    () => {
                      vectorSource.removeLoadedExtent(extent);
                      failure();
                    },
                  );
                },
              }),
            }),
            new VectorLayer({
              minZoom: 11,
              updateWhileInteracting: true,
              updateWhileAnimating: true,
              style: (feature, resolution) => polygonStyleFunction(feature, resolution, `${feature.get('reference')} ${feature.get('name')}`, COLOURS[feature.get('scheme')], true),
              source: new VectorSource({
                attributions: 'WWBOTA&nbsp;references:<a href="https://wwbota.org/" target="_blank">©&nbsp;Bunkers&nbsp;on&nbsp;the&nbsp;Air</a>.',
                strategy: bboxStrategy,
                loader: function loader(extent, resolution, projection, success, failure) {
                  const vectorSource = this;
                  withData(
                    WWBOTA,
                    (features) => {
                      const newFeatures = [];
                      const expandedExtent = buffer(extent, 1000); // To capture centre point
                      features.forEach((feature) => {
                        const geometry = feature.getGeometry();
                        if (vectorSource.getFeatureById(feature.getId()) === null
                            && geometry.intersectsExtent(expandedExtent)) {
                          const coordinates = [];
                          const nSteps = 128;
                          const centerXY = geometry.getCoordinates();
                          for (let i = 0; i < nSteps + 1; i += 1) {
                            const angle = (2 * Math.PI * (i / nSteps)) % (2 * Math.PI);
                            const x = centerXY[0] + Math.cos(-angle) * 1000;
                            const y = centerXY[1] + Math.sin(-angle) * 1000;
                            coordinates.push([x, y]);
                          }
                          const newFeature = feature.clone();
                          newFeature.setGeometry(new Polygon([coordinates]));
                          newFeature.setId(feature.getId()); // ID reset on clone
                          newFeatures.push(newFeature);
                        }
                      });
                      vectorSource.addFeatures(newFeatures);
                      success(newFeatures);
                    },
                    () => {
                      vectorSource.removeLoadedExtent(extent);
                      failure();
                    },
                  );
                },
              }),
            }),
          ],
        }),
      ],
    }),
  ],
});

const link = new Link({params: ['x', 'y', 'z'], replace: true});
function layersLinkCallback(newValue) {
  if (newValue) { // only update if no null
    const layers = newValue.split(' ');
    LayerSwitcher.forEachRecursive(map, (layer) => {
      const shortTitle = layer.get('shortTitle');
      if (shortTitle) {
        if (layers.includes(shortTitle)) {
          layer.setVisible(true);
        } else {
          layer.setVisible(false);
        }
      }
    });
  }
}
layersLinkCallback(link.track('layers', layersLinkCallback));

const activeLayers = new Collection();
LayerSwitcher.forEachRecursive(map, (layer) => {
  const shortTitle = layer.get('shortTitle');
  if (shortTitle) {
    if (layer.getVisible()) {
      activeLayers.push(shortTitle);
    }
    layer.on('change:visible', () => {
      if (layer.getVisible()) {
        activeLayers.push(shortTitle);
      } else {
        activeLayers.remove(shortTitle);
      }
    });
  }
});
activeLayers.on('change:length', () => {
  link.update('layers', activeLayers.getArray().join(' '));
});
map.addInteraction(link);

// Close attribution on map move; open when layers change.
const attribution = new Attribution({collapsible: true, collapsed: false});
map.addControl(attribution);
map.once('movestart', () => { // initial centre map call
  map.on('movestart', () => { attribution.setCollapsed(true); });
});
LayerSwitcher.forEachRecursive(map, (layer) => {
  layer.on('change:visible', () => {
    if (layer.getVisible()) { attribution.setCollapsed(false); }
  });
});

const source = new VectorSource();
const layer = new VectorLayer({
  source: source,
  style: new Style({
    image: new CircleStyle({
      radius: 5,
      fill: new Fill({color: '#AAAAFF'}),
      stroke: new Stroke({color: '#0000FF', width: 1}),
    }),
  }),
});
map.addLayer(layer);

navigator.geolocation.watchPosition(
  (pos) => {
    const coords = [pos.coords.longitude, pos.coords.latitude];
    const accuracy = circular(coords, pos.coords.accuracy);
    source.clear(true);
    source.addFeatures([
      new Feature(
        accuracy.transform('EPSG:4326', 'EPSG:3857'),
      ),
      new Feature(new Point(fromLonLat(coords, 'EPSG:3857'))),
    ]);
  },
  () => {},
  {
    enableHighAccuracy: true,
  },
);

const locate = document.createElement('div');
locate.className = 'ol-control ol-unselectable locate';
locate.innerHTML = '<button title="Locate me">◎</button>';
locate.addEventListener('click', () => {
  if (!source.isEmpty()) {
    map.getView().fit(source.getExtent(), {
      maxZoom: 12,
      duration: 500,
    });
  }
});

map.addControl(
  new Control({
    element: locate,
  }),
);

const layerSwitcher = new LayerSwitcher({
  reverse: true,
  groupSelectStyle: 'none',
  startActive: true,
});
map.addControl(layerSwitcher);
