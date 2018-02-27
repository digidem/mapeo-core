const rimraf = require('rimraf')
const fs = require('fs')
const collect = require('collect-stream')
const test = require('tape')
const store = require('.')
const tmp = require('os-tmpdir')
const path = require('path')

const tmpdir = path.join(tmp(), 'mapfilter-sync-server-test-files')
const tmpdir2 = path.join(tmp(), 'mapfilter-sync-server-test-files-2')
var s1 = store(tmpdir)
var s2 = store(tmpdir2)

function cleanup (s1, s2, t) {
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
  var id = null
  var node = null
  s1.osm.create({
    foo: 'bar',
    timestamp: new Date().toISOString()
  }, done)
  function done (err, _id, _node) {
    t.error(err)
    id = _id
    node = _node
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
        cleanup(s1, s2, t)
      })
    })
  }
})
