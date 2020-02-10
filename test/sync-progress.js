var tape = require('tape')
var helpers = require('./helpers')

tape('sync-progress: 0/0 progress is not reported', function (t) {
  t.plan(5)

  var setup = {
    commonObservations: 0,
    commonMedia: 0,
    cores: [
      {
        uniqueObservations: 0,
        uniqueMedia: 0
      },
      {
        uniqueObservations: 5,
        uniqueMedia: 0
      }
    ]
  }

  helpers.populateWithData(setup, function (err, api, close) {
    t.error(err)

    helpers.startSync(api[0], api[1], function (err, syncer) {
      t.error(err)

      syncer.once('progress', function (p) {
        var unexpected = { sofar: 0, total: 0 }
        t.notDeepEquals(p.db, unexpected, 'first progress event is non 0/0')
      })
      syncer.once('error', function (err) {
        t.error(err)
        close(err => {
          t.error(err)
        })
      })
      syncer.once('end', function () {
        t.ok(true, 'sync done')
        close(err => {
          t.error(err)
        })
      })
    })
  })
})

tape('sync-progress: media progress total is stable', function (t) {
  t.plan(13)

  var setup = {
    commonObservations: 0,
    commonMedia: 0,
    cores: [
      {
        uniqueObservations: 0,
        uniqueMedia: 5
      },
      {
        uniqueObservations: 0,
        uniqueMedia: 5
      }
    ]
  }

  helpers.populateWithData(setup, function (err, api, close) {
    t.error(err)

    helpers.startSync(api[0], api[1], function (err, syncer) {
      t.error(err)

      var firstProgress
      syncer.on('progress', function (p) {
        if (!firstProgress) {
          firstProgress = p
          t.ok(true, 'first progress event')
        } else {
          t.same(p.media.total, firstProgress.media.total, 'media progress total is stable')
        }
      })
      syncer.once('error', function (err) {
        t.error(err)
        close()
      })
      syncer.once('end', function () {
        t.ok(true, 'ended ok')
        close()
      })
    })
  })
})

tape('sync-progress: database progress total is stable', function (t) {
  t.plan(33)

  var setup = {
    commonObservations: 0,
    commonMedia: 0,
    cores: [
      {
        uniqueObservations: 0,
        uniqueMedia: 0
      },
      {
        uniqueObservations: 10,
        uniqueMedia: 0
      },
      {
        uniqueObservations: 10,
        uniqueMedia: 0
      },
      {
        uniqueObservations: 10,
        uniqueMedia: 0
      }
    ],
    syncs: [
      [ 3, 2 ],
      [ 2, 1 ]
    ]
  }

  helpers.populateWithData(setup, function (err, api, close) {
    t.error(err)

    helpers.startSync(api[0], api[1], function (err, syncer) {
      t.error(err)

      var firstProgress
      syncer.on('progress', function (p) {
        if (!firstProgress) {
          firstProgress = p
          t.ok(true)
        } else {
          // XXX: i've seen this fail intermittently!
          t.same(p.db.total, firstProgress.db.total, 'db progress total is stable')
        }
      })
      syncer.once('error', function (err) {
        t.error(err)
        close()
      })
      syncer.once('end', function () {
        close(() => {
          t.ok(true)
        })
      })
    })
  })
})

tape.skip('sync-progress: database sync progress restarts at 0/N per sync', function (t) {
  t.plan(5)

  var setup = {
    commonObservations: 10,
    commonMedia: 0,
    cores: [
      {
        uniqueObservations: 0,
        uniqueMedia: 0
      },
      {
        uniqueObservations: 10,
        uniqueMedia: 0
      }
    ]
  }

  helpers.populateWithData(setup, function (err, api, close) {
    t.error(err)

    helpers.startSync(api[0], api[1], function (err, syncer) {
      t.error(err)

      syncer.once('progress', function (p) {
        t.same(p.db.sofar, 0, 'progress: 0 elements sofar')
        t.same(p.db.total, 10, 'progress: 10 elements total')
      })
      syncer.once('error', function (err) {
        t.error(err)
        close()
      })
      syncer.once('end', function () {
        t.ok(true)
        close()
      })
    })
  })
})

tape.skip('sync-progress: database sync progress includes uploads', function (t) {
  t.plan(4)

  var setup = {
    commonObservations: 10,
    commonMedia: 0,
    cores: [
      {
        uniqueObservations: 10,
        uniqueMedia: 0
      },
      {
        uniqueObservations: 10,
        uniqueMedia: 0
      }
    ]
  }

  helpers.populateWithData(setup, function (err, api, close) {
    t.error(err)

    helpers.startSync(api[0], api[1], function (err, syncer) {
      t.error(err)

      syncer.once('progress', function (p) {
        t.same(p.db.total, 10, 'db progress total is correct')
      })
      syncer.once('error', function (err) {
        t.error(err)
        close()
      })
      syncer.once('end', function () {
        t.ok(true)
        close()
      })
    })
  })
})

tape('sync-progress: correct totals when receiving multiple remote feeds', function (t) {
  t.plan(4)

  var setup = {
    commonObservations: 0,
    commonMedia: 0,
    cores: [
      {
        uniqueObservations: 0,
        uniqueMedia: 0
      },
      {
        uniqueObservations: 10,
        uniqueMedia: 0
      },
      {
        uniqueObservations: 10,
        uniqueMedia: 0
      },
      {
        uniqueObservations: 10,
        uniqueMedia: 0
      }
    ],
    syncs: [
      [ 1, 2 ],
      [ 1, 3 ]
    ]
  }

  helpers.populateWithData(setup, function (err, api, close) {
    t.error(err)

    helpers.startSync(api[0], api[1], function (err, syncer) {
      t.error(err)

      syncer.once('progress', function (p) {
        // XXX: i've seen this fail intermittently!
        t.same(p.db.total, 30, 'initial db total is correct')
      })
      syncer.once('error', function (err) {
        t.error(err)
        close()
      })
      syncer.once('end', function () {
        t.ok(true)
        close()
      })
    })
  })
})

tape.skip('sync-progress: mix of uploading cores & downloading cores', function (t) {
  t.plan(5)

  var setup = {
    commonObservations: 0,
    commonMedia: 0,
    cores: [
      {
        uniqueObservations: 10,
        uniqueMedia: 0
      },
      {
        uniqueObservations: 10,
        uniqueMedia: 0
      },
      {
        uniqueObservations: 10,
        uniqueMedia: 0
      },
      {
        uniqueObservations: 10,
        uniqueMedia: 0
      },
      {
        uniqueObservations: 10,
        uniqueMedia: 0
      }
    ],
    syncs: [
      [0, 1],
      [3, 4]
    ]
  }

  helpers.populateWithData(setup, function (err, api, close) {
    t.error(err)

    // 0 should be uploading 20 and downloading 20 (40 total)
    // 4 should be uploading 20 and downloading 20 (40 total)
    helpers.startSync(api[0], api[4], function (err, syncer) {
      t.error(err)

      syncer.once('progress', function (p) {
        t.same(p.db.sofar, 1, 'initial db sofar is correct')
        t.same(p.db.total, 40, 'initial db total is correct')
      })
      syncer.once('error', function (err) {
        t.error(err)
        close()
      })
      syncer.once('end', function () {
        t.ok(true)
        close()
      })
    })
  })
})

tape('sync-progress: mix of several cores does not hang', function (t) {
  t.plan(8)

  var setup = {
    commonObservations: 0,
    commonMedia: 0,
    cores: [
      {
        uniqueObservations: 10,
        uniqueMedia: 0
      },
      {
        uniqueObservations: 10,
        uniqueMedia: 0
      },
      {
        uniqueObservations: 10,
        uniqueMedia: 0
      },
      {
        uniqueObservations: 10,
        uniqueMedia: 0
      },
      {
        uniqueObservations: 10,
        uniqueMedia: 0
      }
    ],
    syncs: [
      [0, 1],
      [3, 4],
      [4, 2]
    ]
  }

  helpers.populateWithData(setup, function (err, api, close) {
    t.error(err)

    helpers.startSync(api[0], api[4], function (err, syncer) {
      t.error(err)

      syncer.once('error', function (err) {
        t.error(err)
        close()
      })
      syncer.once('end', function () {
        api[0].osm.query([-Infinity, -Infinity, Infinity, Infinity], function (err, data) {
          t.error(err)
          var from0 = data.filter(function (obs) { return obs.version.split('@')[0] === api[0].osm.writer.key.toString('hex') })
          var from1 = data.filter(function (obs) { return obs.version.split('@')[0] === api[1].osm.writer.key.toString('hex') })
          var from2 = data.filter(function (obs) { return obs.version.split('@')[0] === api[2].osm.writer.key.toString('hex') })
          var from3 = data.filter(function (obs) { return obs.version.split('@')[0] === api[3].osm.writer.key.toString('hex') })
          var from4 = data.filter(function (obs) { return obs.version.split('@')[0] === api[4].osm.writer.key.toString('hex') })
          t.same(from0.length, 10, 'all observations from api[0]')
          t.same(from1.length, 10, 'all observations from api[1]')
          t.same(from2.length, 10, 'all observations from api[2]')
          t.same(from3.length, 10, 'all observations from api[3]')
          t.same(from4.length, 10, 'all observations from api[4]')
          close()
        })
      })
    })
  })
})

// TODO
tape.skip('sync-progress: correct database progress /w multiple concurrent syncs', function (t) {
})
