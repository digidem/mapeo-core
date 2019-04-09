var createDb = require('./helpers').createApi
var multifeed = require('multifeed')
var hypercore = require('hypercore')
var ram = require('random-access-memory')
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

      var eventsLeftA = 5
      var eventsLeftB = 5
      a.on('progress', function (sofar, total) {
        eventsLeftA--
      })
      b.on('progress', function (sofar, total) {
        eventsLeftB--
      })

      pump(a, b, a, function (err) {
        t.error(err)
        t.equals(feed1.feeds()[0].length, 3)
        t.equals(feed1.feeds()[1].length, 3)
        t.equals(feed2.feeds()[0].length, 3)
        t.equals(feed2.feeds()[1].length, 3)
        t.equals(eventsLeftA, 0)
        t.equals(eventsLeftB, 0)
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
