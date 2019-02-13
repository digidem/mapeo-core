var path = require('path')
var fs = require('fs')
var os = require('os')
var tape = require('tape')
var helpers = require('./helpers')

function createApis (opts, cb) {
  if (!cb && typeof opts === 'function') {
    cb = opts
    opts = undefined
  }
  opts = opts || {}
  var api1 = helpers.createApi(helpers.tmpdir, opts)
  var api2 = helpers.createApi(helpers.tmpdir2, opts)
  api1.on('error', console.error)
  api2.on('error', console.error)
  function close (cb) {
    cb = cb || function () {}
    var pending = 2
    function done () {
      if (!--pending) cb()
    }

    api1.close(done)
    api2.close(done)
    helpers.cleanupSync()
  }
  cb(api1, api2, close)
}

function verifyTarget (t, api, done) {
  return (target) => {
    var address = api.sync.swarm.address()
    t.same(target.port, address.port, 'target port')
    done()
  }
}

tape('sync: two servers find eachother', function (t) {
  createApis(function (api1, api2, close) {
    var pending = 2

    function done () {
      if (--pending) return
      close()
      t.end()
    }

    api1.sync.listen(function () {
      api2.sync.listen(function () {
        api1.sync.on('target', function (target) {
          var targetId = target.swarmId.toString('hex')
          t.same(targetId, api2.sync.swarm.id.toString('hex'), 'api2 id cmp')
          done()
        })
        api2.sync.on('target', function (target) {
          var targetId = target.swarmId.toString('hex')
          t.same(targetId, api1.sync.swarm.id.toString('hex'), 'api1 id cmp')
          done()
        })
      })
    })
  })
})

tape('sync: replication of a simple observation with media', function (t) {
  t.plan(11)

  createApis(function (api1, api2, close) {
    var obs = {lat: 1, lon: 2, type: 'observation'}
    var ws = api1.media.createWriteStream('foo.txt')
    var pending = 1
    ws.on('finish', written)
    ws.on('error', written)
    ws.end('bar')
          api1.sync.listen()
          api2.sync.listen()

    function written (err) {
      t.error(err)
      if (--pending === 0) {
        api1.osm.create(obs, function (err, _id, node) {
          t.error(err, 'obs1 created')
          id = _id
          setTimeout(function () {
            t.ok(api1.sync.targets().length > 0, 'api 1 has targets')
            t.ok(api2.sync.targets().length > 0, 'api 2 has targets')
            if (api1.sync.targets().length >= 1) {
              sync(api1.sync.targets()[0])
            }
          }, 1000)
          // api1.sync.once('target', function (target) {
          //   setTimeout(sync.bind(null, target), 1000)
          // })
        })
      }
    }

    var id = null

    function sync (target) {
      var syncer = api1.sync.start(target)
      syncer.on('error', function (err) {
        t.error(err)
        close()
        t.fail()
      })

      syncer.on('end', function () {
        t.ok(true, 'replication complete')
        var targets = api1.sync.targets()
        api1.osm.get(id, function (err, node) {
          t.error(err)
          api2.osm.get(id, function (err, _node) {
            t.error(err)
            t.same(node, _node, 'node replicated successfully')
            t.ok(fs.existsSync(path.join(helpers.tmpdir2, 'foo', 'foo.txt')), 'media replicated')
            t.equal(fs.readFileSync(path.join(helpers.tmpdir2, 'foo', 'foo.txt')).toString(), 'bar', 'media replicated')
            close(function () {
              t.ok(true)
            })
          })
        })
      })
    }
  })
})

tape('sync: syncfile replication: hyperlog-sneakernet', function (t) {
  createApis({writeFormat: 'hyperlog-sneakernet'}, function (api1, api2, close) {
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
        api1.sync.replicateFromFile(tmpfile)
          .once('end', syncfileWritten)
          .once('error', syncfileWritten)
      }
    }

    function syncfileWritten (err) {
      t.error(err, 'first syncfile written ok')

      api2.sync.replicateFromFile(tmpfile)
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
  createApis({writeFormat: 'osm-p2p-syncfile'}, function (api1, api2, close) {
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
        api1.sync.replicateFromFile(tmpfile)
          .once('end', syncfileWritten)
          .once('error', syncfileWritten)
      }
    }

    function syncfileWritten (err) {
      t.error(err, 'first syncfile written ok')
      api2.sync.replicateFromFile(tmpfile)
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
