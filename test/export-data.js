const test = require('tape')
const concat = require('concat-stream')
const tmp = require('tmp')
const fs = require('fs')
const data = require('./data-fixture')

const helpers = require('./helpers')
const junglePresets = require('./jungle/presets.json')

tmp.setGracefulCleanup()

test('exportData: geojson when no data', (t) => {
  var mapeo = helpers.createApi()
  mapeo.on('error', console.error)

  var expected = {
    type: 'FeatureCollection',
    features: []
  }

  mapeo.osm.ready(function () {
    var filename = tmp.tmpNameSync()
    mapeo.exportData(filename, err => {
      t.error(err)
      var actual = JSON.parse(fs.readFileSync(filename, 'utf8'))
      t.same(actual, expected)
      mapeo.close(err => { t.error(err); t.end() })
    })
  })
})

test('exportData: geojson with polygon', (t) => {
  var mapeo = helpers.createApi()
  mapeo.on('error', console.error)

  function done () {
    t.end()
    mapeo.close()
  }

  mapeo.osm.ready(function () {
    mapeo.osm.batch(data.polygon.batch, (err) => {
      t.error(err)
      var filename = tmp.tmpNameSync()
      mapeo.exportData(filename, err => {
        t.error(err)
        var actual = JSON.parse(fs.readFileSync(filename, 'utf8'))
        actual.features = actual.features.map((f) => {
          delete f.id
          return f
        })

        t.same(actual, data.polygon.expected)
        done()
      })
    })
  })
})

var exportedGeojson = null

test('exportData: geojson with polygon and presets', (t) => {
  var mapeo = helpers.createApi()
  mapeo.on('error', console.error)

  function done () {
    t.end()
    mapeo.close()
  }

  mapeo.osm.ready(function () {
    var batch = [...data.polygon.batch]
    // Don't mutate batch, because we might re-use it in tests
    batch[0] = { ...batch[0], value: { ...batch[0].value, tags: {'type': 'animal', 'area': 'yes', 'animal-type': 'bluebird'} } }
    mapeo.osm.batch(batch, (err) => {
      t.error(err)
      getOsmStr(mapeo, (err, data) => {
        t.error(err)
        var filename = tmp.tmpNameSync()
        mapeo.exportData(filename, {presets: junglePresets}, err => {
          t.error(err)
          exportedGeojson = JSON.parse(fs.readFileSync(filename, 'utf8'))
          var feature = exportedGeojson.features[0]
          t.ok(feature.properties.icon)
          t.same(feature.properties.type, batch[0].value.tags.type)
          t.same(feature.properties.area, batch[0].value.tags.area)
          t.same(feature.properties['animal-type'], batch[0].value.tags['animal-type'])
          done()
        })
      })
    })
  })
})

test('import: re-import exported polygon with presets', (t) => {
  var mapeo = helpers.createApi()
  mapeo.on('error', console.error)

  function done () {
    t.end()
    mapeo.close()
  }

  mapeo.osm.ready(function () {
    mapeo.importer.importFeatureCollection(exportedGeojson, (err) => {
      t.error(err)
      getOsmStr(mapeo, (err, data) => {
        t.error(err)
        done()
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
