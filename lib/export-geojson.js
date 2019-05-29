var exportGeoJson = require('osm-p2p-geojson')
var pumpify = require('pumpify')

var matchPreset = require('./preset-matcher')
var isPolygonFeature = require('./polygon-feature')

module.exports = function (osm, opts) {
  if (!opts) opts = {}
  var presets = opts.presets
  var matcher = presets ? matchPreset(presets.presets) : null
  function featureMap (f) {
    var newProps = {}
    Object.keys(f.properties).forEach(function (key) {
      if (key === 'id' || key === 'version') return
      var newKey = key.replace(':', '_')
      newProps[newKey] = f.properties[key]
    })
    delete f.id
    f.properties = newProps
    if (matcher) {
      var match = matcher(f)
      if (match) {
        f.properties.icon = match.icon
        f.properties.preset = match.id
      }
    }
    return f
  }

  var bbox = opts.bbox || [ -Infinity, -Infinity, Infinity, Infinity ]
  var polygonFeatures = presets && isPolygonFeature(presets.presets)

  var source = osm.query(bbox, opts)
  var dest = exportGeoJson(osm, {
    map: featureMap,
    polygonFeatures
  })
  return pumpify.obj(source, dest)
}
