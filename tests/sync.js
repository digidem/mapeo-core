var path = require('path')
var fs = require('fs')
var os = require('os')
var tape = require('tape')
var helpers = require('./helpers')

function createStores (opts, cb) {
  if (!cb && typeof opts === 'function') {
    cb = opts
    opts = undefined
  }
  opts = opts || {}
  var api1 = helpers.createStore(helpers.tmpdir, opts)
  var api2 = helpers.createStore(helpers.tmpdir2, opts)
  function close () {
    api1.close()
    api2.close()
    helpers.cleanup()
  }
  cb(api1.sync, api2.sync, close)
}

tape('sync: two servers find eachother', function (t) {
  createStores(function (api1, api2, close) {
    var pending = 2

    function done () {
      pending--
      if (pending) return
      close()
      t.end()
    }

    var verifyTarget = (api) => (target) => {
      var address = api._replicationServer.address()
      t.same(target.port, address.port, 'target port')
      done()
    }
    api1.on('connection', verifyTarget(api2))
    api2.on('connection', verifyTarget(api1))
    api1.listen()
    api2.listen()
  })
})

tape('sync: two servers find eachother twice', function (t) {
  createStores(function (api1, api2, close) {
    var pending = 2
    var closedOnce = false

    function done () {
      pending--
      if (pending) return
      if (closedOnce) {
        close()
        t.end()
        return
      }

      api1.unannounce(function () {
        closedOnce = true
        pending = 2
        api1.announce(function () {
        })
      })
    }

    var verifyTarget = (api) => (target) => {
      var address = api._replicationServer.address()
      t.same(target.port, address.port, 'target port')
      done()
    }
    api1.on('connection', verifyTarget(api2))
    api2.on('connection', verifyTarget(api1))
    api1.listen()
    api2.listen()
  })
})

tape('sync: replication of a simple observation with media', function (t) {
  t.plan(17)
  createStores(function (api1, api2, close) {
    var obs = {lat: 1, lon: 2, type: 'observation'}
    var ws = api1.media.createWriteStream('foo.txt')
    var pending = 1
    ws.on('finish', written)
    ws.on('error', written)
    ws.write('bar')
    ws.end()

    function written (err) {
      t.error(err)
      if (--pending === 0) {
        api1.osm.create(obs, function (err, _id, node) {
          t.error(err, 'obs1 created')
          id = _id
          api1.on('connection', sync)
          api1.listen()
          api2.listen()
        })
      }
    }

    var id = null

    function sync (target) {
      var syncer = api1.syncToTarget(target)
      syncer.on('progress', function (value) {
        t.ok(value === 'osm-connected' || value === 'media-connected', 'progress message')
        var targets = api1.targets()
        t.ok(targets.length)
        t.same(targets[0].host, target.host)
        t.same(targets[0].status, value)
      })
      syncer.on('error', function (err) {
        t.error(err)
        close()
        t.end()
      })

      syncer.on('end', function () {
        t.ok(true, 'replication complete')
        var targets = api1.targets()
        t.same(targets[0].status, 'replication-complete')
        api1.osm.get(id, function (err, node) {
          t.error(err)
          api2.osm.get(id, function (err, _node) {
            t.error(err)
            t.same(node, _node, 'node replicated successfully')
            t.ok(fs.existsSync(path.join(helpers.tmpdir2, 'foo', 'foo.txt')), 'media replicated')
            t.equal(fs.readFileSync(path.join(helpers.tmpdir2, 'foo', 'foo.txt')).toString(), 'bar', 'media replicated')
            close()
            t.end()
          })
        })
      })
    }
  })
})

tape('sync: media replication', function (t) {
  var s1 = helpers.createStore(helpers.tmpdir)
  var s2 = helpers.createStore(helpers.tmpdir2)
  var ws = s1.media.createWriteStream('foo.txt')
  var pending = 1
  ws.on('finish', written)
  ws.on('error', written)
  ws.write('bar')
  ws.end()

  function written (err) {
    t.error(err)
    if (--pending === 0) replicate()
  }

  function replicate () {
    var r1 = s1.sync.mediaReplicationStream()
    var r2 = s2.sync.mediaReplicationStream()
    t.ok(true, 'replication started')

    var pending = 2
    r1.pipe(r2).pipe(r1)
    r1.on('end', done)
    r2.on('end', done)

    function done () {
      if (--pending === 0) {
        t.ok(true, 'replication ended')
        t.ok(fs.existsSync(path.join(helpers.tmpdir2, 'foo', 'foo.txt')))
        t.equal(fs.readFileSync(path.join(helpers.tmpdir2, 'foo', 'foo.txt')).toString(), 'bar')
        s1.close()
        s2.close()
        t.end()
      }
    }
  }
})

tape('sync: syncfile replication: hyperlog-sneakernet', function (t) {
  createStores({writeFormat: 'hyperlog-sneakernet'}, function (api1, api2, close) {
    // create test data
    var id
    var tmpfile = path.join(os.tmpdir(), 'sync1-' + Math.random().toString().substring(2))
    var pending = 2
    var obs = {lat: 1, lon: 2, type: 'observation'}
    api1.osm.create(obs, written)
    var ws = api1.media.createWriteStream('foo.txt')
    ws.once('finish', written)
    ws.once('error', written)
    ws.end('bar')

    function written (err, _id) {
      t.error(err, _id ? 'osm data written ok' : 'media data written ok')
      if (_id) id = _id
      if (--pending === 0) {
        api1.replicateFromFile(tmpfile)
          .once('end', syncfileWritten)
          .once('error', syncfileWritten)
      }
    }

    function syncfileWritten (err) {
      t.error(err, 'first syncfile written ok')

      api2.replicateFromFile(tmpfile)
        .once('end', secondSyncfileWritten)
        .once('error', secondSyncfileWritten)
    }

    function secondSyncfileWritten (err) {
      t.error(err, 'second syncfile written ok')

      api2.osm.get(id, function (err, heads) {
        t.error(err)
        t.equals(Object.keys(heads).length, 1, 'one osm head')
        var res = heads[Object.keys(heads)[0]]
        t.deepEquals(res, obs, 'osm observation matches')
        t.end()
      })
    }
  })
})

tape('sync: syncfile replication: osm-p2p-syncfile', function (t) {
  createStores({writeFormat: 'osm-p2p-syncfile'}, function (api1, api2, close) {
    // create test data
    var id
    var tmpfile = path.join(os.tmpdir(), 'sync1-' + Math.random().toString().substring(2))
    var pending = 2
    var obs = {lat: 1, lon: 2, type: 'observation'}
    api1.osm.create(obs, written)
    var ws = api1.media.createWriteStream('foo.txt')
    ws.once('finish', written)
    ws.once('error', written)
    ws.end('bar')

    function written (err, _id) {
      t.error(err, _id ? 'osm data written ok' : 'media data written ok')
      if (_id) id = _id
      if (--pending === 0) {
        api1.replicateFromFile(tmpfile)
          .once('end', syncfileWritten)
          .once('error', syncfileWritten)
      }
    }

    function syncfileWritten (err) {
      t.error(err, 'first syncfile written ok')
      t.same(api1.targets()[0].status, 'replication-complete', 'replication-complete event')
      api2.replicateFromFile(tmpfile)
        .once('end', secondSyncfileWritten)
        .once('error', secondSyncfileWritten)
    }

    function secondSyncfileWritten (err) {
      t.error(err, 'second syncfile written ok')

      api2.osm.get(id, function (err, heads) {
        t.error(err)
        t.equals(Object.keys(heads).length, 1, 'one osm head')
        var res = heads[Object.keys(heads)[0]]
        t.deepEquals(res, obs, 'osm observation matches')
        api2.media.createReadStream('foo.txt')
          .on('data', function (buf) {
            t.equals(buf.toString(), 'bar')
            t.end()
          })
      })
    }
  })
})
