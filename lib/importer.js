var fs = require('fs')
var osmGeoJson = require('osm-p2p-geojson')
var concat = require('concat-stream')
var shp = require('gtran-shapefile')
var path = require('path')
var inherits = require('inherits')
var events = require('events')

var noop = () => {}
module.exports = Importer

function Importer (osm) {
  if (!(this instanceof Importer)) return new Importer(osm)
  events.EventEmitter.call(this)
  this.importer = osmGeoJson.importer(osm)
}

inherits(Importer, events.EventEmitter)

Importer.prototype.importFeatureCollection = function (geojson, done) {
  return this.importer.importFeatureCollection(geojson, done)
}

Importer.prototype.onerror = function (err) {
  this.emit('error', err)
}

Importer.prototype.importFromFile = function (name, done) {
  if (!done) done = noop
  var ext = path.extname(name)
  var importer = this.importer
  importer.on('error', (err) => {
    this.onerror(err)
  })
  importer.on('done', () => {
    this.emit('complete', name)
  })
  importer.on('import', (index, total) => {
    this.emit('progress', name, index, total)
  })
  if (ext === '.geojson') {
    var readStream = fs.createReadStream(name)
    readStream.on('error', this.onerror.bind(this))
    readStream.pipe(concat(function (data) {
      var geojson = JSON.parse(data)
      return importer.importFeatureCollection(geojson, done)
    }))
  } else if (ext === '.shp') {
    shp.toGeoJson(name).then(function (geojson) {
      return importer.importFeatureCollection(geojson, done)
    })
  }
}
