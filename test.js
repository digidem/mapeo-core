const rimraf = require('rimraf')
const fs = require('fs')
const collect = require('collect-stream')
const test = require('tape')
const store = require('mapfilter-db')
const tmp = require('os-tmpdir')
const path = require('path')

const tmpdir = path.join(tmp(), 'mapfilter-sync-server-test-files')
const tmpdir2 = path.join(tmp(), 'mapfilter-sync-server-test-files-2')
rimraf.sync(tmpdir)
rimraf.sync(tmpdir2)
const feature = {
  "type": "Feature",
  "properties": {},
  "geometry": {
    "type": "Point",
    "coordinates": [
      -96.1083984375,
      39.57182223734374
    ]
  }
}
var s1 = store(tmpdir)
var s2 = store(tmpdir2)
var id = null
var node = null

function cleanup (t) {
  s1.close(function () {
    s2.close(function () {
      rimraf.sync(tmpdir)
      rimraf.sync(tmpdir2)
      t.end()
    })
  })
}

test('local media replication', function (t) {
  var ws = s1.media.createWriteStream('foo.txt')
  var pending  = 1
  ws.on('finish', written)
  ws.on('error', written)
  ws.write('bar')
  ws.end()

  function written (err) {
    t.error(err)
    if (--pending === 0) replicate()
  }

  function replicate () {
    var r1 = s1.createMediaReplicationStream()
    var r2 = s2.createMediaReplicationStream()
    t.ok(true, 'replication started')

    var pending = 2
    r1.pipe(r2).pipe(r1)
    r1.on('end', done)
    r2.on('end', done)

    function done () {
      if (--pending === 0) {
        t.ok(true, 'replication ended')
        t.ok(fs.existsSync(path.join(tmpdir2, 'media', 'foo', 'foo.txt')))
        t.equal(fs.readFileSync(path.join(tmpdir2, 'media', 'foo', 'foo.txt')).toString(), 'bar')
        t.end()
      }
    }
  }
})

test('local osm replication', function (t) {
  s1.observationCreate(feature, done)
  function done (err, _node) {
    t.error(err)
    node = _node
    id = node.value.k
    feature.id = id
    s1.osm.get(id, function (err, docs) {
      t.error(err)
      t.same(docs[node.key], node.value.v)
      replicate()
    })
  }
  function replicate () {
    var r1 = s1.createOsmReplicationStream()
    var r2 = s2.createOsmReplicationStream()
    r1.pipe(r2).pipe(r1).on('end', function () {
      s2.osm.get(id, function (err, docs) {
        t.error(err)
        t.same(docs[node.key], node.value.v)
        t.end()
      })
    })
  }
})

test('observationList', function (t) {
  s1.observationList(function (err, features) {
    t.error(err)
    t.same(features.length, 1)
    t.same(features[0].type, 'observation')
    t.ok(features[0].timestamp)
    t.ok(features[0].id)
    t.ok(features[0].tags)
    t.end()
  })
})

test('observationCreate', function (t) {
  s1.observationCreate({
    type: 'Feature',
    properties: {'bee': 'bop'}
  }, function (err) {
    t.error(err)
    s1.observationList(function (err, features) {
      t.error(err)
      t.same(features.length, 2)
      t.end()
    })
  })
})

test('observationUpdate', function (t) {
  var coords = [
    -95.1083984375,
    40.57182223734374
  ]
  feature.geometry = {
    "type": "Point",
    "coordinates": coords
  }
  s1.observationUpdate(feature, function (err) {
    t.error(err)
    s1.osm.get(feature.id, function (err, doc) {
      t.error(err)
      t.ok(doc)
      var value = Object.values(doc)[0]
      t.same(value.lon, coords[0])
      t.same(value.lat, coords[1])
      t.end()
    })
  })
})

test('observationDelete', function (t) {
  s1.observationDelete(id, function (err) {
    t.error(err)
    s1.observationList(function (err, features) {
      t.error(err)
      t.same(features.length, 1)
      cleanup(t)
    })
  })
})
