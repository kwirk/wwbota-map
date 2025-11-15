import './style.css';
import 'ol-layerswitcher/dist/ol-layerswitcher.css';
import 'ol-popup/dist/ol-popup.css';

import {
  Collection, Feature, Map, View,
} from 'ol';
import LayerGroup from 'ol/layer/Group';
import ImageLayer from 'ol/layer/Image';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import OSM from 'ol/source/OSM';
import RasterSource from 'ol/source/Raster';
import XYZ from 'ol/source/XYZ';
import {bbox as bboxStrategy} from 'ol/loadingstrategy';
import {fromLonLat, toLonLat, transformExtent} from 'ol/proj';
import {
  buffer,
  getCenter,
  getIntersection,
  extend,
} from 'ol/extent';
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
import Popup from 'ol-popup';
import { LRUCache } from 'lru-cache';

import COUNTRIES from './data/countries.json?url';

const COLOURS = {
  UKBOTA: 'rgba(122, 174, 0, 1)',
  ONBOTA: 'rgba(244, 197, 36, 1)',
  OKBOTA: 'rgba(13, 71, 160, 1)',
  Z3BOTA: 'rgba(212, 5, 8, 1)',
  ZABOTA: 'rgba(212, 5, 8, 1)',
  S5BOTA: 'rgba(24, 123, 34, 1)',
  FBOTA: 'rgba(13, 71, 160, 1)',
  LABOTA: 'rgba(197, 7, 38, 1)',
  ITABOTA: 'rgba(197, 7, 38, 1)',
  EIBOTA: 'rgba(76, 176, 80, 1)',
  PABOTA: 'rgba(176, 22, 35, 1)',
  DLBOTA: 'rgba(255, 207, 0, 1)',
  ROBOTA: 'rgba(1, 34, 105, 1)',
  EABOTA: 'rgba(173, 21, 25, 1)',
  '9MBOTA': 'rgba(2, 0, 102, 1)',
  SPBOTA: 'rgba(220, 20, 60, 1)',
  CABOTA: 'rgba(255, 0, 0, 1)',
};

const OUTLINE_COLOURS = {
  UKBOTA: 'rgba(0, 0, 0, 1)',
  ONBOTA: 'rgba(0, 0, 0, 1)',
  OKBOTA: 'rgba(197, 7, 38, 1)',
  Z3BOTA: 'rgba(252, 228, 0, 1)',
  ZABOTA: 'rgba(0, 0, 0, 1)',
  S5BOTA: 'rgba(211, 0, 19, 1)',
  FBOTA: 'rgba(197, 7, 38, 1)',
  LABOTA: 'rgba(13, 71, 160, 1)',
  ITABOTA: 'rgba(24, 123, 34, 1)',
  EIBOTA: 'rgba(234, 122, 12, 1)',
  PABOTA: 'rgba(27, 68, 140, 1)',
  DLBOTA: 'rgba(222, 0, 0, 1)',
  ROBOTA: 'rgba(213, 9, 39, 1)',
  EABOTA: 'rgba(250, 189, 0, 1)',
  '9MBOTA': 'rgba(255, 202, 0, 1)',
  SPBOTA: 'rgba(255, 255, 255, 1)',
  CABOTA: 'rgba(255, 255, 255, 1)',
};

const RADIUS = { // metres; default 1km
  OKBOTA: 300,
  PABOTA: 300,
};

const COUNTRY_SCHEME = {
  GBR: 'UKBOTA',
  IMN: 'UKBOTA',
  JEY: 'UKBOTA',
  GGY: 'UKBOTA',
  BEL: 'ONBOTA',
  CZE: 'OKBOTA',
  MKD: 'Z3BOTA',
  ALB: 'ZABOTA',
  SVN: 'S5BOTA',
  FRA: 'FBOTA',
  NOR: 'LABOTA',
  ITA: 'ITABOTA',
  IRL: 'EIBOTA',
  NLD: 'PABOTA',
  DEU: 'DLBOTA',
  ROU: 'ROBOTA',
  ESP: 'EABOTA',
  MYS: '9MBOTA',
  POL: 'SPBOTA',
  CAN: 'CABOTA',
};

const URLS = {
  UKBOTA: 'https://bunkersontheair.org/',
  ONBOTA: 'https://onbota.be',
  OKBOTA: 'https://okbota.cz/',
  Z3BOTA: 'https://wwbota.org/z3bota/',
  ZABOTA: 'https://wwbota.org/zabota/',
  S5BOTA: 'https://wwbota.org/s5bota-2/',
  FBOTA: 'https://www.qsl.net/f1lpt/',
  LABOTA: 'https://wwbota.org/labota/',
  ITABOTA: 'https://wwbota.org/itabota/',
  EIBOTA: 'https://wwbota.org/eibota/',
  PABOTA: 'https://pa3efr.nl/index.php/miscellaneous/dutch-bunkers-on-the-air-pabota',
  DLBOTA: 'https://dlbota.de/',
  ROBOTA: 'https://www.robota.org.ro/',
  EABOTA: 'https://eabota.es/',
  '9MBOTA': 'https://9mbota.hamradio.my/',
  SPBOTA: 'https://www.spbota.pl/',
  CABOTA: 'https://wwbota.org/',
};

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
  getIntersection(newExtent, [-180, -90, 180, 90], newExtent);
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

// Styles
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
  let text;
  if (resolution < 350) {
    text = feature.get('reference');
    if (resolution < 40) {
      text += ` ${feature.get('name')}`;
    }
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
    text: text && createTextStyle(feature, resolution, text, color, textOffset),
  });
}

function polygonStyleFunction(feature, resolution, text, color, outlineColor, opacity = 0.2) {
  return new Style({
    stroke: new Stroke({
      color: outlineColor || '#000000',
      width: outlineColor ? 2 : 1,
    }),
    fill: new Fill({
      color: colorOpacity(color, opacity),
    }),
    text: text ? createTextStyle(feature, resolution, text, color, 0) : undefined,
  });
}


function otaGridStrategy(extent) {
  const newExtent = transformExtent(extent, 'EPSG:3857', 'EPSG:4326');
  const [x0, y0, xN, yN] = [
    Math.floor(newExtent[0]/5)*5,
    Math.floor(newExtent[1]/2.5)*2.5,
    Math.ceil(newExtent[2]/5)*5,
    Math.ceil(newExtent[3]/2.5)*2.5];
  const extents = [];
  for (let x = x0; x < xN; x += 5) {
    for (let y = y0; y < yN; y += 2.5) {
      extents.push(transformExtent([x, y, x + 5, y + 2.5], 'EPSG:4326', 'EPSG:3857'));
    }
  }
  return extents;
}

const OSMSource = new OSM({
  attributions: 'Map:&nbsp;©<a href="https://openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>&nbsp;contributors.',
});

const map = new Map({
  target: 'map',
  controls: [new Zoom(), new Rotate(), new ScaleLine()],
  view: new View({
    center: [0, 0],
    zoom: 0,
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
        new TileLayer({
          title: 'ESRI World Imagery',
          shortTitle: 'ESRIWI',
          type: 'base',
          visible: false,
          source: new XYZ({
            attributions: ['Powered by Esri',
              'Source: Esri, DigitalGlobe, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, and the GIS User Community'],
            attributionsCollapsible: false,
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            maxZoom: 23
          })
        })
      ],
    }),
    new VectorLayer({
      maxZoom: 8,
      style: (feature, resolution) => polygonStyleFunction(feature, resolution, null, COLOURS[COUNTRY_SCHEME[feature.get('ADM0_A3')]], OUTLINE_COLOURS[COUNTRY_SCHEME[feature.get('ADM0_A3')]], 0.5),
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
              style: (feature, resolution) => {
                const centerXY = feature.getGeometry().getCoordinates();
                const centerLonLat = toLonLat(centerXY, 'EPSG:3857');
                const scaleFactor = 1 / Math.cos(centerLonLat[1] * (Math.PI / 180));
                const radius = (RADIUS[feature.get('scheme')] || 1000) * scaleFactor;
                return pointStyleFunction(feature, resolution, COLOURS[feature.get('scheme')], radius / resolution);
              },
              source: new VectorSource({
                attributions: 'WWBOTA&nbsp;references:<a href="https://wwbota.org/" target="_blank">©&nbsp;Bunkers&nbsp;on&nbsp;the&nbsp;Air</a>.',
                format: new GeoJSONReference(),
                strategy: otaGridStrategy,
                url: (extent) => {
                  const newExtent = transformExtent(extent, 'EPSG:3857', 'EPSG:4326');
                  const [minLon, minLat, maxLon, maxLat] = [
                    Math.round(newExtent[0]/5)*5,
                    Math.round(newExtent[1]/2.5)*2.5,
                    Math.round(newExtent[2]/5)*5,
                    Math.round(newExtent[3]/2.5)*2.5];
                  return `https://api.wwbota.org/bunkers/?format=GEOJSON&bbox=${minLon},${minLat},${maxLon},${maxLat}`;
                },
              }),
            }),
            new VectorLayer({
              minZoom: 11,
              updateWhileInteracting: true,
              updateWhileAnimating: true,
              style: (feature, resolution) => polygonStyleFunction(feature, resolution, `${feature.get('reference')} ${feature.get('name')}`, COLOURS[feature.get('scheme')]),
              source: new VectorSource({
                attributions: 'WWBOTA&nbsp;references:<a href="https://wwbota.org/" target="_blank">©&nbsp;Bunkers&nbsp;on&nbsp;the&nbsp;Air</a>.',
                format: new GeoJSONReference(),
                strategy: otaGridStrategy,
                loader: function loader(extent, resolution, projection, success, failure) {
                  const vectorSource = this;
                  const newExtent = transformExtent(extent, 'EPSG:3857', 'EPSG:4326');
                  const [minLon, minLat, maxLon, maxLat] = [
                    Math.round(newExtent[0]/5)*5,
                    Math.round(newExtent[1]/2.5)*2.5,
                    Math.round(newExtent[2]/5)*5,
                    Math.round(newExtent[3]/2.5)*2.5];
                  const url = `https://api.wwbota.org/bunkers/?format=GEOJSON&bbox=${minLon},${minLat},${maxLon},${maxLat}`;
                  const xhr = new XMLHttpRequest();
                  xhr.open('GET', url);
                  xhr.responseType = 'json';
                  function onError() {
                    vectorSource.removeLoadedExtent(extent);
                    failure();
                  }
                  xhr.onerror = onError;
                  xhr.onload = () => {
                    if (xhr.status === 200) {
                      const newFeatures = [];
                      const features = vectorSource.getFormat().readFeatures(xhr.response);
                      features.forEach((feature) => {
                        const geometry = feature.getGeometry();
                        if (vectorSource.getFeatureById(feature.getId()) === null) {
                          const centerLonLat = geometry.getCoordinates();
                          const newGeometry = circular(centerLonLat, RADIUS[feature.get('scheme')] || 1000, 64).transform('EPSG:4326', 'EPSG:3857');
                          feature.setGeometry(newGeometry);
                          newFeatures.push(feature);
                        }
                      });
                      vectorSource.addFeatures(newFeatures);
                      success(newFeatures);
                    };
                  };
                  xhr.send();
                },
              }),
            }),
          ],
        }),
      ],
    }),
  ],
});

const link = new Link({params: ['x', 'y', 'z'], replace: true, animate: false});
function layersLinkCallback(newValue) {
  if (newValue) { // only update if no null
    const layers = newValue.split(' ');
    LayerSwitcher.forEachRecursive(map, (layer) => {
      const shortTitle = layer.get('shortTitle');
      if (shortTitle) {
        if (layers.includes(shortTitle)
            || (layers.includes('BING') && shortTitle === "ESRIWI")) {
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

const popup = new Popup();
map.addOverlay(popup);
map.on('singleclick', (event) => {
  const refs = new Set();
  const content = document.createElement('ul');
  map.forEachFeatureAtPixel(
    event.pixel,
    (feature) => {
      const ref = feature.get('reference');
      const countryCode = feature.get('ADM0_A3');
      if (ref && !refs.has(ref)) {
        refs.add(ref);
        const listItem = document.createElement('li');
        const refText = document.createElement('b');
        refText.innerText = ref;
        const refName = document.createElement('em');
        refName.innerText = ` ${feature.get('name')}`;
        listItem.appendChild(refText);
        listItem.appendChild(refName);
        content.appendChild(listItem);
      } else if (countryCode) {
        const scheme = COUNTRY_SCHEME[countryCode];

        const refLink = document.createElement('a');
        refLink.href = URLS[scheme];
        refLink.textContent = scheme;
        refLink.target = '_blank';

        const listItem = document.createElement('li');
        listItem.appendChild(refLink);
        content.appendChild(listItem);
      }
    },
  );
  const mapsLink = document.createElement('a');
  const [lon, lat] = toLonLat(event.coordinate)
  mapsLink.href = `https://www.google.com/maps/search/?api=1&query=${lat}%2C${lon}`;
  mapsLink.textContent = `Google Maps`;
  mapsLink.target = '_blank';
  const listItem = document.createElement('li');
  listItem.appendChild(mapsLink);
  content.appendChild(listItem);
  if (content.hasChildNodes()) { popup.show(event.coordinate, content); }
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
