const test = require('tape')
const concat = require('concat-stream')
const cloneDeep = require('clone-deep')
const data = require('./data-fixture')

const helpers = require('./helpers')
const junglePresets = require('./jungle/presets.json')

test('createDataStream: geojson when no data', (t) => {
  var mapeo = helpers.createApi()
  mapeo.on('error', t.error)

  function done () {
    mapeo.close(err => { t.error(err); t.end() })
  }

  var expected = {
    type: 'FeatureCollection',
    features: []
  }

  mapeo.osm.ready(function () {
    var rs = mapeo.createDataStream()
    rs.on('error', t.error)

    rs.pipe(concat((data) => {
      t.same(expected, JSON.parse(data))
      done()
    }))
  })
})

test('createDataStream: geojson with polygon', (t) => {
  var mapeo = helpers.createApi()
  mapeo.on('error', console.error)

  function done () {
    mapeo.close(err => { t.error(err); t.end() })
  }

  mapeo.osm.ready(function () {
    mapeo.osm.batch(data.polygon.batch, (err) => {
      t.error(err)
      var rs = mapeo.createDataStream()
      rs.pipe(concat((geojson) => {
        var actual = JSON.parse(geojson)
        actual.features = actual.features.map((f) => {
          delete f.id
          return f
        })

        t.same(actual, data.polygon.expected)
        done()
      }))
    })
  })
})

test('createDataStream: include metadata', (t) => {
  var mapeo = helpers.createApi()
  mapeo.on('error', console.error)

  function done () {
    mapeo.close(err => { t.error(err); t.end() })
  }

  mapeo.osm.ready(function () {
    mapeo.osm.batch(data.polygon.batch, (err) => {
      t.error(err)
      var rs = mapeo.createDataStream({ metadata: ['id'] })
      rs.pipe(concat((geojson) => {
        var actual = JSON.parse(geojson)

        // Expect properties.id to match id of input way
        var expected = cloneDeep(data.polygon.expected)
        var expectedId = data.polygon.batch.find(v => v.value.type === 'way').id
        expected.features[0].properties.id = expectedId
        expected.features[0].id = expectedId

        t.same(actual, expected)
        done()
      }))
    })
  })
})

test('exportData: geojson with polygon and presets', (t) => {
  var mapeo = helpers.createApi()
  mapeo.on('error', t.error)

  function done () {
    mapeo.close(err => { t.error(err); t.end() })
  }

  mapeo.osm.ready(function () {
    var batch = [...data.polygon.batch]
    // Don't mutate batch, because we might re-use it in tests
    batch[0] = { ...batch[0], value: { ...batch[0].value, tags: {'type': 'animal', 'area': 'yes', 'animal-type': 'bluebird'} } }
    mapeo.osm.batch(batch, (err) => {
      t.error(err)
      getOsmStr(mapeo, (err, data) => {
        t.error(err)
        var rs = mapeo.createDataStream({presets: junglePresets})
        rs.pipe(concat((data) => {
          var exportedGeojson = JSON.parse(data)
          var feature = exportedGeojson.features[0]
          t.ok(feature.properties.icon)
          t.same(feature.properties.type, batch[0].value.tags.type)
          t.same(feature.properties.area, batch[0].value.tags.area)
          t.same(feature.properties['animal-type'], batch[0].value.tags['animal-type'])
          done()
        }))
      })
    })
  })
})

test('createDataStream: filter only point', (t) => {
  var mapeo = helpers.createApi()
  mapeo.on('error', t.error)

  function done () {
    mapeo.close(err => { t.error(err); t.end() })
  }

  var filter = ['==', '$type', 'node']
  var batchAll = data.polygon.batch.concat(data.way.batch, data.node.batch)

  mapeo.osm.ready(function () {
    mapeo.osm.batch(batchAll, (err) => {
      t.error(err)
      var rs = mapeo.createDataStream({ filter })
      rs.pipe(concat((geojson) => {
        var actual = JSON.parse(geojson)
        actual.features = actual.features.map((f) => {
          delete f.id
          return f
        })
        t.same(actual, data.node.expected)
        done()
      }))
    })
  })
})

test('createDataStream: filter only with tag \'interesting\'', (t) => {
  var mapeo = helpers.createApi()
  mapeo.on('error', t.error)

  function done () {
    mapeo.close(err => { t.error(err); t.end() })
  }

  var filter = ['has', 'interesting']
  var batchAll = data.polygon.batch.concat(data.way.batch, data.node.batch)
  var expected = {
    type: 'FeatureCollection',
    // TODO: Order is not guaranteed!
    features: [...data.way.expected.features, ...data.node.expected.features]
  }

  mapeo.osm.ready(function () {
    mapeo.osm.batch(batchAll, (err) => {
      t.error(err)
      var rs = mapeo.createDataStream({ filter })
      rs.pipe(concat((geojson) => {
        var actual = JSON.parse(geojson)
        actual.features = actual.features.map((f) => {
          delete f.id
          return f
        })
        t.same(actual, expected)
        done()
      }))
    })
  })
})

test('createDataStream: filter only with tag \'area\' == \'yes\'', (t) => {
  var mapeo = helpers.createApi()
  mapeo.on('error', t.error)

  function done () {
    mapeo.close(err => { t.error(err); t.end() })
  }

  var filter = ['==', 'area', 'yes']
  var batchAll = data.polygon.batch.concat(data.way.batch, data.node.batch)

  mapeo.osm.ready(function () {
    mapeo.osm.batch(batchAll, (err) => {
      t.error(err)
      var rs = mapeo.createDataStream({ filter })
      rs.pipe(concat((geojson) => {
        var actual = JSON.parse(geojson)
        actual.features = actual.features.map((f) => {
          delete f.id
          return f
        })
        t.same(actual, data.polygon.expected)
        done()
      }))
    })
  })
})

// **TODO**: Add test for sync file creation

function getOsmStr (mapeo, cb) {
  var query = mapeo.osm.query([-Infinity, -Infinity, Infinity, Infinity])
  query.pipe(concat((data) => {
    cb(null, data)
  })).on('error', cb)
}
