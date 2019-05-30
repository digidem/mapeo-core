var concat = require('concat-stream')
var shapefile = require('gtran-shapefile')
var exportGeoJson = require('./export-geojson')

module.exports = exportShapefile

function exportShapefile (osm, filename, opts, done) {
  if (!done && typeof opts === 'function') {
    done = opts
    opts = {}
  }
  var GeoJSONStream = exportGeoJson(osm, opts)
  GeoJSONStream.on('error', done)
  GeoJSONStream.pipe(concat((geojson) => {
    shapefile.fromGeoJson(JSON.parse(geojson), filename).then(function (filenames) {
      done(null, filenames)
    })
  }))
}
