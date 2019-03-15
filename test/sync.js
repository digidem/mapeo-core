var path = require('path')
var os = require('os')
var tape = require('tape')

var kappahealth = require('./kappahealth')
var helpers = require('./helpers')
var generateObservations = require('./generateObservations')

function createApis (opts, cb) {
  if (!cb && typeof opts === 'function') {
    cb = opts
    opts = undefined
  }
  opts = opts || {}
  var api1 = helpers.createApi(helpers.tmpdir1, opts.api1)
  var api2 = helpers.createApi(helpers.tmpdir2, opts.api2)
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
  }
  api1.osm.ready(function () {
    api2.osm.ready(function () {
      cb(api1, api2, close)
    })
  })
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
  t.plan(13)

  createApis(function (api1, api2, close) {
    var obs = {lat: 1, lon: 2, type: 'observation'}
    var ws = api1.media.createWriteStream('foo.txt')
    var pending = 3
    ws.on('finish', written)
    ws.on('error', written)
    ws.end('bar')
    api1.sync.listen()
    api1.sync.on('target', written.bind(null, null))
    api2.sync.listen()
    api2.sync.on('target', written.bind(null, null))

    function written (err) {
      t.error(err)
      if (--pending === 0) {
        api1.osm.create(obs, function (err, _id, node) {
          t.error(err, 'obs1 created')
          id = _id
          t.ok(api1.sync.targets().length > 0, 'api 1 has targets')
          t.ok(api2.sync.targets().length > 0, 'api 2 has targets')
          if (api1.sync.targets().length >= 1) {
            sync(api1.sync.targets()[0])
          }
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
        api1.osm.get(id, function (err, node) {
          t.error(err)
          api2.osm.get(id, function (err, _node) {
            t.error(err)
            t.same(node, _node, 'node replicated successfully')
            api2.media.exists('foo.txt', function (err, exists) {
              t.error(err)
              t.ok(exists)
              close(function () {
                t.ok(true)
              })
            })
          })
        })
      })
    }
  })
})

tape('sync: access sync state and progress', function (t) {
  var i = 200

  function createManyObservations (m, total, cb) {
    generateObservations(i, function (_, obs) {
      m.observationCreate(obs, (_, node) => {
        if (total-- === 1) {
          t.ok('200 observations created')
          return cb()
        }
      })
    })
  }

  createApis(function (api1, api2, close1) {
    createApis(function (api3, _, close2) {
      createManyObservations(api2, i, function () {
        createManyObservations(api3, i, function () {
          listen()
        })
      })

      function listen () {
        var pending = 6
        var found = () => {
          pending--
          if (pending === 0) {
            var targets = api1.sync.targets()
            if (targets.length === 2) {
              sync(api1, targets[0])
            }
          }
        }
        api1.sync.listen()
        api1.sync.on('target', found)
        api2.sync.listen()
        api2.sync.on('target', found)
        api3.sync.listen()
        api3.sync.on('target', found)
      }

      function sync (api, target) {
        console.log('syncing with', target)
        var syncer = api.sync.start(target)
        syncer.on('error', function (err) {
          t.error(err)
          close()
          t.fail()
        })
        var health = kappahealth(api.osm.core)

        function calculateProgress (remoteFeeds) {
          return remoteFeeds.map((feed) => {
            var peers = feed.peers
            console.log(feed.key.toString('hex'), peers)
            var res = peers.map((peer) => {
              if (!peer) return 0
              var remoteHas = peer.have
              var length = remoteFeeds[0].length
              return ((length - remoteHas) / length) * 100
            })
            return res
          })
        }

        var interval = setInterval(function () {
          var remoteFeeds = health.get()
          if (remoteFeeds.length) {
            // t.same(feeds[0].key.toString('hex'), remoteFeeds[0].key)
            console.log('percent complete', calculateProgress(remoteFeeds))
          }
          // console.log(JSON.stringify(remoteFeeds, null, 2))
        }, 100)

        syncer.on('end', function () {
          t.ok(true, 'replication complete')
          clearInterval(interval)
          var remoteFeeds = health.get()
          console.log('done percent complete', calculateProgress(remoteFeeds))
          close1(() => {
            close2(() => t.end())
          })
        })
      }
    })
  })
})

tape('sync: syncfile replication: osm-p2p-syncfile', function (t) {
  createApis({api1:{writeFormat: 'osm-p2p-syncfile'}}, function (api1, api2, close) {
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

    function written (err, res) {
      t.error(err, res ? 'osm data written ok' : 'media data written ok')
      if (res) id = res.id
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
        t.same(res.id, id)
        t.same(res.lat, obs.lat)
        t.same(res.lon, obs.lon)
        api2.media.createReadStream('foo.txt')
          .on('data', function (buf) {
            t.equals(buf.toString(), 'bar')
            t.end()
          })
      })
    }
  })
})

tape('sync: media: desktop <-> desktop', function (t) {
  t.plan(18)

  function writeBlob (api, filename, cb) {
    var pending = 3
    var ws = api.media.createWriteStream('original/' + filename, done)
    ws.end(filename)

    ws = api.media.createWriteStream('preview/' + filename, done)
    ws.end(filename)

    ws = api.media.createWriteStream('thumbnail/' + filename, done)
    ws.end(filename)

    function done (err) {
      t.error(err)
      if (!--pending) cb()
    }
  }

  var opts = {api1:{deviceType:'desktop'}, api2:{deviceType:'desktop'}}
  createApis(opts, function (api1, api2, close) {
    var pending = 4

    api1.sync.listen()
    api1.sync.on('target', written.bind(null, null))
    api2.sync.listen()
    api2.sync.on('target', written.bind(null, null))
    writeBlob(api1, 'hello_world.png', written)
    writeBlob(api2, 'goodbye_world.png', written)

    function written (err) {
      t.error(err)
      if (--pending === 0) {
        t.ok(api1.sync.targets().length > 0, 'api 1 has targets')
        t.ok(api2.sync.targets().length > 0, 'api 2 has targets')
        if (api1.sync.targets().length >= 1) {
          sync(api1.sync.targets()[0])
        }
      }
    }

    function sync (target) {
      var syncer = api1.sync.start(target)
      syncer.on('error', function (err) {
        t.error(err)
        close()
        t.fail()
      })

      syncer.on('end', function () {
        t.ok(true, 'replication complete')
        var pending = 2
        var expected = [
          'original/goodbye_world.png',
          'original/hello_world.png',
          'preview/goodbye_world.png',
          'preview/hello_world.png',
          'thumbnail/goodbye_world.png',
          'thumbnail/hello_world.png'
        ]
        api1.media.list(function (err, files) {
          t.error(err)
          t.deepEquals(files.sort(), expected.sort())
          if (!--pending) close(() => t.ok(true))
        })
        api2.media.list(function (err, files) {
          t.error(err)
          t.deepEquals(files.sort(), expected.sort())
          if (!--pending) close(() => t.ok(true))
        })
      })
    }
  })
})

tape('sync: media: mobile <-> desktop', function (t) {
  t.plan(18)

  function writeBlob (api, filename, cb) {
    var pending = 3
    var ws = api.media.createWriteStream('original/' + filename, done)
    ws.end(filename)

    ws = api.media.createWriteStream('preview/' + filename, done)
    ws.end(filename)

    ws = api.media.createWriteStream('thumbnail/' + filename, done)
    ws.end(filename)

    function done (err) {
      t.error(err)
      if (!--pending) cb()
    }
  }

  var opts = {api1:{deviceType:'mobile'}, api2:{deviceType:'desktop'}}
  createApis(opts, function (api1, api2, close) {
    var pending = 4

    api1.sync.listen()
    api1.sync.on('target', written.bind(null, null))
    api2.sync.listen()
    api2.sync.on('target', written.bind(null, null))
    writeBlob(api1, 'hello_world.png', written)
    writeBlob(api2, 'goodbye_world.png', written)

    function written (err) {
      t.error(err)
      if (--pending === 0) {
        t.ok(api1.sync.targets().length > 0, 'api 1 has targets')
        t.ok(api2.sync.targets().length > 0, 'api 2 has targets')
        if (api1.sync.targets().length >= 1) {
          sync(api1.sync.targets()[0])
        }
      }
    }

    function sync (target) {
      var syncer = api1.sync.start(target)
      syncer.on('error', function (err) {
        t.error(err)
        close()
        t.fail()
      })

      syncer.on('end', function () {
        t.ok(true, 'replication complete')
        var pending = 2
        var expected1 = [
          'original/hello_world.png',
          'preview/goodbye_world.png',
          'preview/hello_world.png',
          'thumbnail/goodbye_world.png',
          'thumbnail/hello_world.png'
        ]
        var expected2 = [
          'original/goodbye_world.png',
          'original/hello_world.png',
          'preview/goodbye_world.png',
          'preview/hello_world.png',
          'thumbnail/goodbye_world.png',
          'thumbnail/hello_world.png'
        ]
        api1.media.list(function (err, files) {
          t.error(err)
          t.deepEquals(files.sort(), expected1.sort())
          if (!--pending) close(() => t.ok(true))
        })
        api2.media.list(function (err, files) {
          t.error(err)
          t.deepEquals(files.sort(), expected2.sort())
          if (!--pending) close(() => t.ok(true))
        })
      })
    }
  })
})

tape('sync: media: mobile <-> mobile', function (t) {
  t.plan(18)

  function writeBlob (api, filename, cb) {
    var pending = 3
    var ws = api.media.createWriteStream('original/' + filename, done)
    ws.end(filename)

    ws = api.media.createWriteStream('preview/' + filename, done)
    ws.end(filename)

    ws = api.media.createWriteStream('thumbnail/' + filename, done)
    ws.end(filename)

    function done (err) {
      t.error(err)
      if (!--pending) cb()
    }
  }

  var opts = {api1:{deviceType:'mobile'}, api2:{deviceType:'mobile'}}
  createApis(opts, function (api1, api2, close) {
    var pending = 4

    api1.sync.listen()
    api1.sync.on('target', written.bind(null, null))
    api2.sync.listen()
    api2.sync.on('target', written.bind(null, null))
    writeBlob(api1, 'hello_world.png', written)
    writeBlob(api2, 'goodbye_world.png', written)

    function written (err) {
      t.error(err)
      if (--pending === 0) {
        t.ok(api1.sync.targets().length > 0, 'api 1 has targets')
        t.ok(api2.sync.targets().length > 0, 'api 2 has targets')
        if (api1.sync.targets().length >= 1) {
          sync(api1.sync.targets()[0])
        }
      }
    }

    function sync (target) {
      var syncer = api1.sync.start(target)
      syncer.on('error', function (err) {
        t.error(err)
        close()
        t.fail()
      })

      syncer.on('end', function () {
        t.ok(true, 'replication complete')
        var pending = 2
        var expected1 = [
          'original/hello_world.png',
          'preview/goodbye_world.png',
          'preview/hello_world.png',
          'thumbnail/goodbye_world.png',
          'thumbnail/hello_world.png'
        ]
        var expected2 = [
          'original/goodbye_world.png',
          'preview/goodbye_world.png',
          'preview/hello_world.png',
          'thumbnail/goodbye_world.png',
          'thumbnail/hello_world.png'
        ]
        api1.media.list(function (err, files) {
          t.error(err)
          t.deepEquals(files.sort(), expected1.sort())
          if (!--pending) close(() => t.ok(true))
        })
        api2.media.list(function (err, files) {
          t.error(err)
          t.deepEquals(files.sort(), expected2.sort())
          if (!--pending) close(() => t.ok(true))
        })
      })
    }
  })
})
