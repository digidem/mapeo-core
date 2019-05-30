var concat = require('concat-stream')
var pump = require('pump')
var fs = require('fs')
var exportGeoJson = require('./export-geojson')

module.exports = exportShapefile

function exportShapefile (osm, filename, opts, done) {
  if (!done && typeof opts === 'function') {
    done = opts
    opts = {}
  }
  }))
}
