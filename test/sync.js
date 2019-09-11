var path = require('path')
var os = require('os')
var tape = require('tape')
var rimraf = require('rimraf')
var itar = require('indexed-tarball')

var helpers = require('./helpers')

function createApis (opts, cb) {
  if (!cb && typeof opts === 'function') {
    cb = opts
    opts = undefined
  }
  opts = opts || {}
  var api1 = helpers.createApi(null, opts.api1)
  var api2 = helpers.createApi(null, opts.api2)
  api1.on('error', console.error)
  api2.on('error', console.error)
  function close (cb) {
    cb = cb || function () {}
    var pending = 2
    function done () {
      if (!--pending) {
        rimraf(api1._dir, function () {
          rimraf(api2._dir, function () {
            cb()
          })
        })
      }
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

tape('sync: trying to sync to unknown peer', function (t) {
  var api1 = helpers.createApi(null)
  function done () {
    api1.close()
    t.end()
  }

  api1.sync.listen()
  api1.sync.join()
  var emitter = api1.sync.replicate({host: 'not a thing', port: 1337})
  emitter.on('error', (err) => {
    t.ok(err)
    done()
  })
})

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
        api1.sync.join()
        api2.sync.join()
        api1.sync.on('peer', function (peer) {
          var peerId = peer.swarmId.toString('hex')
          t.same(peerId, api2.sync.swarm.id.toString('hex'), 'api2 id cmp')
          done()
        })
        api2.sync.on('peer', function (peer) {
          var peerId = peer.swarmId.toString('hex')
          t.same(peerId, api1.sync.swarm.id.toString('hex'), 'api1 id cmp')
          done()
        })
      })
    })
  })
})

tape('sync: remote peer error/destroyed is reflected in peer state', function (t) {
  createApis(function (api1, api2, close) {
    var pending = 2

    function done () {
      if (pending === 1) {
        setTimeout(() => {
          api2.close()
        }, 2000)
      }
      if (--pending) return
      close()
      t.end()
    }

    api1.sync.listen(function () {
      api2.sync.listen(function () {
        function check (api) {
          return (peer) => {
            var peerId = peer.swarmId.toString('hex')
            t.same(peerId, api.sync.swarm.id.toString('hex'), 'api2 id cmp')
            done()
          }
        }
        api1.sync.on('peer', check(api2))
        api2.sync.on('peer', check(api1))
        api1.sync.on('down', function () {
          var peers = api1.sync.peers()
          t.same(peers.length, 0)
        })
        api1.sync.join()
        api2.sync.join()
      })
    })
  })
})

tape('sync: replication of a simple observation with media', function (t) {
  t.plan(15)
  var complete = false

  createApis(function (api1, api2, close) {
    var obs = {lat: 1, lon: 2, type: 'observation'}
    var ws = api1.media.createWriteStream('foo.txt')
    var pending = 3
    ws.on('finish', written)
    ws.on('error', written)
    ws.end('bar')
    api1.sync.listen()
    api1.sync.join()
    api1.sync.on('peer', written.bind(null, null))
    api2.sync.listen()
    api2.sync.join()
    api2.sync.on('peer', written.bind(null, null))

    function written (err) {
      t.error(err)
      if (--pending === 0) {
        api1.osm.create(obs, function (err, _id, node) {
          t.error(err, 'obs1 created')
          id = _id
          t.ok(api1.sync.peers().length > 0, 'api 1 has peers')
          t.ok(api2.sync.peers().length > 0, 'api 2 has peers')
          if (api1.sync.peers().length >= 1) {
            var peer = api1.sync.peers()[0]
            sync(peer)
          }
        })
      }
    }

    var id = null

    function sync (peer) {
      var syncer = api1.sync.replicate(peer)
      syncer.on('error', function (err) {
        t.error(err)
        close()
        t.fail()
      })
      syncer.on('end', function () {
        complete = true
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
                if (complete) {
                  t.same(peer.state.topic, 'replication-complete')
                  var date = new Date(peer.state.message)
                  t.ok(date.getTime() < new Date().getTime(), 'last completed date')
                }
              })
            })
          })
        })
      })
    }
  })
})

tape('bad sync: syncfile replication: osm-p2p-syncfile', function (t) {
  t.plan(2)

  var tmpfile = path.join(os.tmpdir(), 'sync1-' + Math.random().toString().substring(2))
  var syncfile = new itar(tmpfile)
  syncfile.userdata({syncfile: { 'p2p-db': 'hyperlog' } }, start)

  function start () {
    createApis({api1:{writeFormat: 'osm-p2p-syncfile'}}, function (api1, api2, close) {
      api1.sync.replicate({filename: tmpfile})
        .once('end', function () {
          t.fail()
        })
        .once('error', function (err) {
          t.ok(err)
          t.same(err.message, 'trying to sync this kappa-osm database with a hyperlog database!')
        })
        .on('progress', function (progress) {
          t.fail()
        })
    })
  }
})

tape('sync: syncfile replication: osm-p2p-syncfile', function (t) {
  createApis({api1:{writeFormat: 'osm-p2p-syncfile'}}, function (api1, api2, close) {
    // create test data
    var id
    var tmpfile = path.join(os.tmpdir(), 'sync1-' + Math.random().toString().substring(2))
    var pending = 2
    var lastProgress
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
        api1.sync.replicate({filename: tmpfile})
          .once('end', syncfileWritten)
          .once('error', syncfileWritten)
          .on('progress', function (progress) {
            lastProgress = progress
          })
      }
    }

    function syncfileWritten (err) {
      t.error(err, 'first syncfile written ok')
      t.deepEquals(lastProgress, {
        db: { sofar: 1, total: 1 },
        media: { sofar: 1, total: 1 }
      }, 'first progress state ok')

      api2.sync.replicate({filename: tmpfile})
        .once('end', secondSyncfileWritten)
        .once('error', secondSyncfileWritten)
        .on('progress', function (progress) {
          lastProgress = progress
        })
    }

    function secondSyncfileWritten (err) {
      t.error(err, 'second syncfile written ok')
      t.deepEquals(lastProgress, {
        db: { sofar: 1, total: 1 },
        media: { sofar: 1, total: 1 }
      }, 'second progress state ok')

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

tape('sync: try to sync two different projectId syncfiles together', function (t) {
  t.plan(2)

  var tmpfile = path.join(os.tmpdir(), 'sync1-' + Math.random().toString().substring(2))
  var syncfile = new itar(tmpfile)
  syncfile.userdata({syncfile: { 'p2p-db': 'kappa-osm', projectId: 'bar' } }, start)

  function start () {
    createApis({api1:{writeFormat: 'osm-p2p-syncfile'}}, function (api1, api2, close) {
      api1.sync.replicate({filename: tmpfile}, {projectId: 'foo'})
        .once('end', function () {
          t.fail()
        })
        .once('error', function (err) {
          t.ok(err)
          t.ok(/trying to sync two different projects/.test(err.message), 'expected error message')
        })
        .on('progress', function (progress) {
          t.fail()
        })
    })
  }
})

tape('sync: syncfile /wo projectId, api with projectId set', function (t) {
  createApis({api1:{writeFormat: 'osm-p2p-syncfile'}}, function (api1, api2, close) {
    // create test data
    var id
    var tmpfile = path.join(os.tmpdir(), 'sync1-' + Math.random().toString().substring(2))
    var pending = 2
    var lastProgress
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
        api1.sync.replicate({filename: tmpfile}, {projectId:'quux'})
          .once('end', syncfileWritten)
          .once('error', syncfileWritten)
          .on('progress', function (progress) {
            lastProgress = progress
          })
      }
    }

    function syncfileWritten (err) {
      t.error(err, 'first syncfile written ok')
      t.deepEquals(lastProgress, {
        db: { sofar: 1, total: 1 },
        media: { sofar: 1, total: 1 }
      }, 'first progress state ok')

      api2.sync.replicate({filename: tmpfile})
        .once('end', secondSyncfileWritten)
        .once('error', secondSyncfileWritten)
        .on('progress', function (progress) {
          lastProgress = progress
        })
    }

    function secondSyncfileWritten (err) {
      t.error(err, 'second syncfile written ok')
      t.deepEquals(lastProgress, {
        db: { sofar: 1, total: 1 },
        media: { sofar: 1, total: 1 }
      }, 'second progress state ok')

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

tape('sync: desktop <-> desktop photos', function (t) {
  t.plan(14)

  var opts = {api1:{deviceType:'desktop'}, api2:{deviceType:'desktop'}}
  createApis(opts, function (api1, api2, close) {
    var pending = 4
    var total = 5
    var lastProgress

    api2.sync.setName('device_2')

    api1.sync.listen()
    api1.sync.join()
    api1.sync.once('peer', written.bind(null, null))
    api2.sync.listen()
    api2.sync.join()
    api2.sync.once('peer', written.bind(null, null))
    helpers.writeBigData(api1, total, written)
    writeBlob(api2, 'goodbye_world.png', written)

    function written (err) {
      t.error(err)
      if (--pending === 0) {
        var peers1 = api1.sync.peers()
        var peers2 = api2.sync.peers()
        if (peers1.length >= 1 && peers2.length >= 1) {
          sync(peers1[0])
        }
      }
    }

    function sync (peer) {
      t.equals(peer.name, 'device_2')
      var syncer = api1.sync.replicate(peer)
      syncer.on('error', function (err) {
        t.error(err)
        close()
        t.fail()
      })

      syncer.once('progress', function (progress) {
        lastProgress = progress
      })

      syncer.on('end', function () {
        t.ok(true, 'replication complete')
        t.deepEquals(lastProgress, {
          db: { sofar: 5, total: 5 },
          media: { sofar: 18, total: 18 }
        }, 'progress state ok')

        var peers1 = api1.sync.peers()
        var peers2 = api2.sync.peers()
        t.same(peers1[0].state.topic, 'replication-complete')
        setTimeout(function () {
          t.same(peers2[0].state.topic, 'replication-complete')
        }, 2000)
        var pending = 2
        var expected = mockExpectedMedia(total)
          .concat([
            'original/goodbye_world.png',
            'preview/goodbye_world.png',
            'thumbnail/goodbye_world.png'
          ])
        api1.media.list(function (err, files) {
          t.error(err)
          t.deepEquals(files.sort(), expected.sort(), 'api1 has the files')
          if (!--pending) close(() => t.ok(true))
        })
        api2.media.list(function (err, files) {
          t.error(err)
          t.deepEquals(files.sort(), expected.sort(), 'api2 has the files')
          if (!--pending) close(() => t.ok(true))
        })
      })
    }
  })
})

tape('sync: deletes are not synced back', function (t) {
  t.plan(17)

  var deleted

  var opts = {api1:{deviceType:'desktop'}, api2:{deviceType:'desktop'}}
  createApis(opts, function (api1, api2, close) {
    var pending = 4
    var total = 5
    var lastProgress

    api2.sync.setName('device_2')

    api1.sync.listen()
    api1.sync.join()
    api1.sync.once('peer', written.bind(null, null))
    api2.sync.listen()
    api2.sync.join()
    api2.sync.once('peer', written.bind(null, null))
    helpers.writeBigData(api1, total, written)
    writeBlob(api2, 'goodbye_world.png', written)

    function written (err) {
      t.error(err)
      if (--pending === 0) {
        var peers1 = api1.sync.peers()
        var peers2 = api2.sync.peers()
        if (peers1.length >= 1 && peers2.length >= 1) {
          sync(peers1[0])
        }
      }
    }

    function deleteObs () {
      api1.sync.once('peer', (peer) => {
        api2.observationList(function (err, results2) {
          t.error(err)
          api1.observationList(function (err, results) {
            t.error(err)
            t.same(results2, results)
            deleted = results[0]
            api1.observationDelete(deleted.id, (err) => {
              t.error(err)
              var syncer = api1.sync.replicate(peer)
              syncer.on('error', (err) => t.error(err))
              syncer.on('end', () => {
                api2.observationList(function (err, after) {
                  t.error(err)
                  t.same(results.length - 1, after.length, 'one less item in list')
                  close(() => t.end())
                })
              })
            })
          })
        })
      })
    }

    function sync (peer) {
      t.equals(peer.name, 'device_2')
      var syncer = api1.sync.replicate(peer)
      syncer.on('error', function (err) {
        t.error(err)
        close()
        t.fail()
      })

      syncer.once('progress', function (progress) {
        lastProgress = progress
      })

      syncer.on('end', function () {
        t.ok(true, 'replication complete')
        t.deepEquals(lastProgress, {
          db: { sofar: 5, total: 5 },
          media: { sofar: 18, total: 18 }
        }, 'progress state ok')

        var pending = 2
        var expected = mockExpectedMedia(total)
          .concat([
            'original/goodbye_world.png',
            'preview/goodbye_world.png',
            'thumbnail/goodbye_world.png'
          ])
        api1.media.list(function (err, files) {
          t.error(err)
          t.deepEquals(files.sort(), expected.sort(), 'api1 has the files')
          if (!--pending) deleteObs()
        })
        api2.media.list(function (err, files) {
          t.error(err)
          t.deepEquals(files.sort(), expected.sort(), 'api2 has the files')
          if (!--pending) deleteObs()
        })
      })
    }
  })
})

tape('sync: mobile <-> desktop photos', function (t) {
  t.plan(12)

  var opts = {
    api1: { deviceType: 'mobile' },
    api2: { deviceType: 'desktop' }
  }
  createApis(opts, function (api1, api2, close) {
    var pending = 4
    var total = 5
    var mobile = api1
    var desktop = api2

    mobile.sync.listen()
    mobile.sync.join()
    mobile.sync.on('peer', written.bind(null, null))
    desktop.sync.listen()
    desktop.sync.join()
    desktop.sync.on('peer', written.bind(null, null))
    helpers.writeBigData(mobile, total, written)
    writeBlob(desktop, 'goodbye_world.png', written)

    function written (err) {
      t.error(err)
      if (--pending === 0) {
        t.ok(mobile.sync.peers().length > 0, 'api 1 has peers')
        t.ok(desktop.sync.peers().length > 0, 'api 2 has peers')
        if (mobile.sync.peers().length >= 1) {
          sync(mobile.sync.peers()[0])
        }
      }
    }

    function sync (peer) {
      var syncer = mobile.sync.replicate(peer)
      syncer.on('error', function (err) {
        t.error(err)
        close()
        t.fail()
      })

      syncer.on('end', function () {
        t.ok(true, 'replication complete')
        var pending = 2
        var expectedMobile = mockExpectedMedia(total)
          .concat([
            'preview/goodbye_world.png',
            'thumbnail/goodbye_world.png'
          ])
        var expectedDesktop = mockExpectedMedia(total)
          .concat([
            'original/goodbye_world.png',
            'preview/goodbye_world.png',
            'thumbnail/goodbye_world.png'
          ])
        mobile.media.list(function (err, files) {
          t.error(err)
          t.deepEquals(files.sort(), expectedMobile.sort())
          if (!--pending) close(() => t.ok(true))
        })
        desktop.media.list(function (err, files) {
          t.error(err)
          t.deepEquals(files.sort(), expectedDesktop.sort())
          if (!--pending) close(() => t.ok(true))
        })
      })
    }
  })
})

tape('sync: mobile <-> mobile photos', function (t) {
  t.plan(12)

  var opts = {api1:{deviceType:'mobile'}, api2:{deviceType:'mobile'}}
  createApis(opts, function (api1, api2, close) {
    var pending = 4
    var total = 5

    var clone = api2

    api1.sync.listen()
    api1.sync.join()
    api1.sync.on('peer', written.bind(null, null))
    clone.sync.listen()
    clone.sync.join()
    clone.sync.on('peer', written.bind(null, null))
    helpers.writeBigData(api1, total, written)
    writeBlob(clone, 'goodbye_world.png', written)

    function written (err) {
      t.error(err)
      if (--pending === 0) {
        t.ok(api1.sync.peers().length > 0, 'api 1 has peers')
        t.ok(clone.sync.peers().length > 0, 'api 2 has peers')
        if (api1.sync.peers().length >= 1) {
          sync(api1.sync.peers()[0])
        }
      }
    }

    function sync (peer) {
      var syncer = api1.sync.replicate(peer)
      syncer.on('error', function (err) {
        t.error(err)
        close()
        t.fail()
      })

      syncer.on('end', function () {
        t.ok(true, 'replication complete')
        var pending = 2
        var expected1 = mockExpectedMedia(total).concat([
          'preview/goodbye_world.png',
          'thumbnail/goodbye_world.png'
        ])
        var expectedClone = mockExpectedMedia(total)
          .filter((m) => !m.startsWith('original/'))
          .concat([
            'original/goodbye_world.png',
            'preview/goodbye_world.png',
            'thumbnail/goodbye_world.png'
          ])
        api1.media.list(function (err, files) {
          t.error(err)
          t.deepEquals(files.sort(), expected1.sort())
          if (!--pending) close(() => t.ok(true))
        })
        clone.media.list(function (err, files) {
          t.error(err)
          t.deepEquals(files.sort(), expectedClone.sort())
          if (!--pending) close(() => t.ok(true))
        })
      })
    }
  })
})

tape('sync: with two peers available, sync with one only triggers events for one sync', function (t) {
  var opts = {api1:{name: 'boop', deviceType:'desktop'}, api2:{name: 'beep', deviceType:'desktop'}}
  createApis(opts, function (api1, api2, close1) {
    var opts = {api1:{name: 'bork', deviceType:'mobile'}, api2:{name: 'baz', deviceType:'mobile'}}
    createApis(opts, function (api3, api4, close2) {
      var pending = 6
      var total = 20

      function doListen (api, cb) {
        api.sync.listen()
        api.sync.join()
        api.on('error', console.error)
        api.sync.once('peer', cb.bind(null, null))
      }

      var target

      helpers.writeBigData(api1, total, written)
      writeBlob(api2, 'goodbye_world.png', written)

      doListen(api1, written)
      doListen(api2, written)
      doListen(api3, written)
      doListen(api4, written)

      function written (err) {
        t.error(err)
        if (--pending === 0) {
          t.ok(api1.sync.peers().length > 0, 'api 1 has peers')
          t.ok(api2.sync.peers().length > 0, 'api 2 has peers')
          t.ok(api3.sync.peers().length > 0, 'api 3 has peers')
          t.ok(api4.sync.peers().length > 0, 'api 4 has peers')
          if (api1.sync.peers().length >= 1) {
            target = api1.sync.peers()[0]
            sync(target)
          }
        }
      }

      function sync (peer) {
        var syncer = api1.sync.replicate(peer)
        syncer.on('error', t.error)
        syncer.on('end', function () {
          setTimeout(function () {
            var peers = api1.sync.peers()
            peers.forEach((p) => {
              t.same(p.state.topic, 'replication-wifi-ready')
            })
            close1()
            close2()
            t.end()
          }, 2000)
        })

        var totalProgressEvents = 0
        syncer.on('progress', function (progress) {
          var peers = api1.sync.peers()
          t.same(peers.length, 3, 'three peers')
          if (totalProgressEvents > 1) {
            peers.forEach((p) => {
              if (p.name === target.name) t.same(p.state.topic, 'replication-progress', 'target has progress event')
              else t.same(p.state.topic, 'replication-wifi-ready')
            })
          }
          totalProgressEvents += 1
        })
      }
    })
  })
})


tape('sync: destroy during sync is reflected in peer state', function (t) {
  t.plan(11)

  var opts = {api1:{deviceType:'desktop'}, api2:{deviceType:'desktop'}}
  createApis(opts, function (api1, api2, close) {
    var pending = 4
    var total = 20

    api1.sync.listen()
    api1.sync.join()
    api1.sync.once('peer', written.bind(null, null))
    api2.sync.listen()
    api2.sync.join()
    api2.sync.once('peer', written.bind(null, null))
    helpers.writeBigData(api1, total, written)
    writeBlob(api2, 'goodbye_world.png', written)

    api1.on('error', console.error)
    api2.on('error', console.error)

    function written (err) {
      t.error(err)
      if (--pending === 0) {
        t.ok(api1.sync.peers().length > 0, 'api 1 has peers')
        t.ok(api2.sync.peers().length > 0, 'api 2 has peers')
        if (api1.sync.peers().length >= 1) {
          sync(api1.sync.peers()[0])
        }
      }
    }

    function sync (peer) {
      var syncer = api1.sync.replicate(peer)
      syncer.on('error', function (err) {
        t.ok(err)
        var peers = api1.sync.peers()
        t.same(peers.length, 1, 'one peer on error')
        t.same(peers[0].state.topic, 'replication-error', 'replication error!')
        t.same(peers[0].state.message, err.toString(), 'got message')
        close(function () {
          t.ok(true)
        })
      })

      var totalProgressEvents = 0
      syncer.on('progress', function (progress) {
        totalProgressEvents += 1
        if (totalProgressEvents > 5) api2.sync.close()
      })
    }
  })
})

tape('sync: 200 photos', function (t) {
  t.plan(14)
  var opts = {api1:{deviceType:'desktop'}, api2:{deviceType:'desktop'}}
  createApis(opts, function (api1, api2, close) {
    var pending = 4
    var total = 200

    api1.sync.listen()
    api1.sync.join()
    api1.sync.on('peer', written.bind(null, null))
    api2.sync.listen()
    api2.sync.join()
    api2.sync.on('peer', written.bind(null, null))
    helpers.writeBigData(api1, total, written)
    writeBlob(api2, 'goodbye_world.png', written)

    function written (err) {
      t.error(err)
      if (--pending === 0) {
        t.ok(api1.sync.peers().length > 0, 'api 1 has peers')
        t.ok(api2.sync.peers().length > 0, 'api 2 has peers')
        if (api1.sync.peers().length >= 1) {
          sync(api2.sync.peers()[0])
        }
      }
    }

    function sync (peer) {
      var syncer = api2.sync.replicate(peer)
      syncer.on('error', function (err) {
        t.error(err)
        close()
        t.fail()
      })

      var totalProgressEvents = 0
      var lastProgress
      syncer.on('progress', function (progress) {
        lastProgress = progress
        totalProgressEvents += 1
      })

      syncer.on('end', function () {
        t.ok(true, 'replication complete')
        var pending = 2
        var expectedMedia = mockExpectedMedia(total)
          .concat([
            'original/goodbye_world.png',
            'preview/goodbye_world.png',
            'thumbnail/goodbye_world.png'
          ])
        t.deepEquals(lastProgress, {
          db: { sofar: total, total: total },
          media: { sofar: expectedMedia.length, total: expectedMedia.length }
        }, 'progress state ok')
        t.ok(totalProgressEvents >= expectedMedia.length, 'all progress events fire')

        api1.media.list(function (err, files) {
          t.error(err, 'listed media1 ok')
          t.deepEquals(files.sort(), expectedMedia.sort(), 'api1 has the files')
          if (!--pending) close(() => t.ok(true))
        })
        api2.media.list(function (err, files) {
          t.error(err, 'listed media2 ok')
          t.deepEquals(files.sort(), expectedMedia.sort(), 'api2 has the files')
          if (!--pending) close(() => t.ok(true))
        })
      })
    }
  })
})

function mockExpectedMedia (total) {
  var expected = []
  for (var i = 0; i < total; i++) {
    expected.push(`original/foo-${i}.jpg`)
    expected.push(`thumbnail/foo-${i}.jpg`)
    expected.push(`preview/foo-${i}.jpg`)
  }
  return expected
}

function writeBlob (api, filename, cb) {
  var pending = 3
  var ws = api.media.createWriteStream('original/' + filename, done)
  ws.end(filename)

  ws = api.media.createWriteStream('preview/' + filename, done)
  ws.end(filename)

  ws = api.media.createWriteStream('thumbnail/' + filename, done)
  ws.end(filename)

  function done (err) {
    if (err) return cb(err)
    if (!--pending) cb()
  }
}

