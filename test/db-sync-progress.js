var createDb = require('./helpers').createApi
var sync = require('../lib/db-sync-progress')
var pump = require('pump')
var test = require('tape')

function setup (numEntries, cb) {
  var db = createDb()
  if (!numEntries) {
    db.osm.ready(cb.bind(null, null, db))
    return
  }

  var ops = new Array(numEntries).fill(0).map(function () {
    return {
      type: 'put',
      value: {
        type: 'node',
        lat: String(Math.random()),
        lon: String(Math.random()),
        changeset: String(Math.random()).substring(2)
      }
    }
  })
  db.osm.batch(ops, function (err) {
    if (err) cb(err)
    else {
      db.osm.ready(cb.bind(null, null, db))
    }
  })
}

test('sync progress: no entries', function (t) {
  t.plan(6)

  setup(0, function (err, db1) {
    t.error(err)
    setup(0, function (err, db2) {
      t.error(err)

      var a = sync(db1, { live: false })
      var b = sync(db2, { live: false })

      pump(a, b, a, function () {
        t.equals(db1.osm.core._logs.feeds().length, 2)
        t.equals(db2.osm.core._logs.feeds().length, 2)
        t.equals(db1.osm.core._logs.feeds()[0].length, 0)
        t.equals(db2.osm.core._logs.feeds()[1].length, 0)
      })
    })
  })
})

test('sync progress: 6 entries', function (t) {
  t.plan(9)

  setup(3, function (err, db1) {
    t.error(err)
    setup(3, function (err, db2) {
      t.error(err)
      var feed1 = db1.osm.core._logs
      var feed2 = db2.osm.core._logs

      var a = sync(db1, { live: false })
      var b = sync(db2, { live: false })

      var aLastProgress, bLastProgress
      a.on('progress', function (sofar, total) {
        aLastProgress = { sofar, total }
      })
      b.on('progress', function (sofar, total) {
        bLastProgress = { sofar, total }
      })

      pump(a, b, a, function (err) {
        t.error(err)
        t.equals(feed1.feeds()[0].length, 3)
        t.equals(feed1.feeds()[1].length, 3)
        t.equals(feed2.feeds()[0].length, 3)
        t.equals(feed2.feeds()[1].length, 3)
        t.same(aLastProgress.sofar, aLastProgress.total, 'a progress ok')
        t.same(bLastProgress.sofar, bLastProgress.total, 'b progress ok')
      })
    })
  })
})

test('sync progress: 200 entries', function (t) {
  t.plan(11)

  setup(100, function (err, db1) {
    t.error(err)
    setup(100, function (err, db2) {
      t.error(err)
      var feed1 = db1.osm.core._logs
      var feed2 = db2.osm.core._logs

      var a = sync(db1, { live: false })
      var b = sync(db2, { live: false })

      var sofarA, totalA
      var sofarB, totalB
      a.on('progress', function (sofar, total) {
        sofarA = sofar
        totalA = total
      })
      b.on('progress', function (sofar, total) {
        sofarB = sofar
        totalB = total
      })

      pump(a, b, a, function (err) {
        t.error(err)
        t.equals(feed1.feeds()[0].length, 100)
        t.equals(feed1.feeds()[1].length, 100)
        t.equals(feed2.feeds()[0].length, 100)
        t.equals(feed2.feeds()[1].length, 100)
        t.equals(sofarA, 200)
        t.equals(sofarA, 200)
        t.equals(totalB, 200)
        t.equals(totalB, 200)
      })
    })
  })
})

test('sync progress: 3 devices', function (t) {
  t.plan(7)

  let aLastProgress
  let bLastProgress
  let cLastProgress

  setup(3, function (err, db1) {
    t.error(err)
    setup(3, function (err, db2) {
      t.error(err)
      setup(3, function (err, db3) {
        t.error(err)
        var feed1 = db1.osm.core._logs
        var feed2 = db2.osm.core._logs
        var feed3 = db3.osm.core._logs

        var a = sync(db1, { live: false })
        var b = sync(db2, { live: false })
        var c = sync(db3, { live: false })

        a.on('progress', function (sofar, total) {
          aLastProgress = { sofar, total }
        })
        b.on('progress', function (sofar, total) {
          bLastProgress = { sofar, total }
        })
        c.on('progress', function (sofar, total) {
          cLastProgress = { sofar, total }
        })

        pump(a, b, a, function (err) {
          t.error(err)
          t.same(aLastProgress.sofar, aLastProgress.total, 'a progress ok')
          t.same(bLastProgress.sofar, bLastProgress.total, 'b progress ok')
          t.same(cLastProgress.sofar, cLastProgress.total, 'c progress ok')
        })
      })
    })
  })
})

test('sync progress: 200 entries', function (t) {
  t.plan(14)

  setup(100, function (err, db1) {
    t.error(err)
    setup(100, function (err, db2) {
      t.error(err)
      var feed1 = db1.osm.core._logs
      var feed2 = db2.osm.core._logs

      var a = sync(db1, { live: false })
      var b = sync(db2, { live: false })

      var sofarA, totalA
      var sofarB, totalB
      a.on('progress', function (sofar, total) {
        sofarA = sofar
        totalA = total
      })
      b.on('progress', function (sofar, total) {
        sofarB = sofar
        totalB = total
      })

      pump(a, b, a, function (err) {
        t.error(err)
        t.equals(feed1.feeds()[0].length, 100)
        t.equals(feed1.feeds()[1].length, 100)
        t.equals(feed2.feeds()[0].length, 100)
        t.equals(feed2.feeds()[1].length, 100)
        t.equals(sofarA, 200, 'got all 200 events')
        t.equals(sofarA, 200, 'got all 200 events')
        t.equals(totalB, 200, 'got all 200 events')
        t.equals(totalB, 200, 'got all 200 events')
        db1.getFeedStatus((_, stats) => {
          t.same(stats.length, 2)
          t.same(stats[0].sofar, stats[0].total, 'getFeedStatus sofar and total same')
          t.same(stats[1].sofar, stats[1].total, 'getFeedStatus sofar and total same')
        })
      })
    })
  })
})

test('missing data: device status', function (t) {
  setup(100, function (err, db1) {
    t.error(err)
    setup(100, function (err, db2) {
      t.error(err)
      var a = sync(db1, { live: false })
      var b = sync(db2, { live: false })

      var events = 0
      a.on('progress', function (sofar, total) {
        events += 1
        if (events > 50 && events < 100) db2.close()
      })

      pump(a, b, a, function (err) {
        t.ok(err)
        db1.getFeedStatus((_, stats) => {
          t.same(stats.length, 2)
          var val = stats.find((s) => s.sofar !== s.total)
          t.ok(val.sofar < val.total, 'sofar is less than total in database status')
          t.end()
        })
      })
    })
  })
})

