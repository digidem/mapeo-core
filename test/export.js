const test = require('tape')
const concat = require('concat-stream')
const data = require('./data-fixture')

const helpers = require('./helpers')
const junglePresets = require('./jungle/presets.json')
const exportGeoJson = require('../lib/export-geojson')

test('export: geojson when no data', (t) => {
  helpers.createApi(function (mapeo, close) {
    mapeo.on('error', console.error)

    var expected = {
      type: 'FeatureCollection',
      features: []
    }

    mapeo.osm.ready(function () {
      var rs = exportGeoJson(mapeo.osm)
      rs.pipe(concat((data) => {
        t.same(expected, JSON.parse(data))
        close()
        t.end()
      }))
    })
  })
})

test('export: geojson with polygon', (t) => {
  helpers.createApi(function (mapeo, close) {
    mapeo.on('error', console.error)

    mapeo.osm.ready(function () {
      mapeo.osm.batch(data.polygon.batch, (err) => {
        t.error(err)
        var rs = exportGeoJson(mapeo.osm)
        rs.pipe(concat((geojson) => {
          var actual = JSON.parse(geojson)
          actual.features = actual.features.map((f) => {
            delete f.id
            return f
          })

          t.same(data.polygon.expected, actual)
          close()
          t.end()
        }))
      })
    })
  })
})

var exportedGeojson = null

test('export: geojson with polygon and presets', (t) => {
  helpers.createApi(function (mapeo, close) {
    mapeo.on('error', console.error)

    mapeo.osm.ready(function () {
      var batch = data.polygon.batch
      batch[0].value.tags = {'type': 'animal', 'area': 'yes', 'animal-type': 'bluebird'}
      mapeo.osm.batch(batch, (err) => {
        t.error(err)
        getOsmStr(mapeo, (err, data) => {
          t.error(err)
          var rs = exportGeoJson(mapeo.osm, {presets: junglePresets})
          rs.pipe(concat((data) => {
            exportedGeojson = JSON.parse(data)
            var feature = exportedGeojson.features[0]
            t.ok(feature.properties.icon)
            t.same(feature.properties.type, batch[0].value.tags.type)
            t.same(feature.properties.area, batch[0].value.tags.area)
            t.same(feature.properties['animal-type'], batch[0].value.tags['animal-type'])
            close()
            t.end()
          }))
        })
      })
    })
  })
})

test('import: re-import exported polygon with presets', (t) => {
  helpers.createApi(function (mapeo, close) {
    mapeo.on('error', console.error)

    mapeo.osm.ready(function () {
      mapeo.importer.importFeatureCollection(exportedGeojson, (err) => {
        t.error(err)
        getOsmStr(mapeo, (err, data) => {
          t.error(err)
          close()
          t.end()
        })
      })
    })
  })
})

function getOsmStr (mapeo, cb) {
  var query = mapeo.osm.query([-Infinity, -Infinity, Infinity, Infinity])
  query.pipe(concat((data) => {
    cb(null, data)
  })).on('error', cb)
}
