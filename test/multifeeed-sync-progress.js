var multifeed = require('multifeed')
var hypercore = require('hypercore')
var ram = require('random-access-memory')
var sync = require('../lib/multifeed-sync-progress')
var pump = require('pump')
var test = require('tape')

function setup (numEntries, cb) {
  var feed = multifeed(hypercore, ram, { valueEncoding: 'json' })
  feed.writer('default', function (err, writer) {
    if (err) return cb(err)
    if (!numEntries) return cb(null, feed, writer)
    var entries = new Array(numEntries).fill(0).map(function () {
      return { value: Math.random() }
    })
    writer.append(entries, function (err) {
      if (err) cb(err)
      else cb(null, feed, writer)
    })
  })
}

test('multifeed sync progress: no entries', function (t) {
  t.plan(5)

  setup(0, function (err, feed1, writer1) {
    t.error(err)
    setup(0, function (err, feed2, writer2) {
      t.error(err)

      var a = sync(feed1, { live: false })
      var b = sync(feed2, { live: false })

      pump(a, b, a, function (err) {
        t.error(err)
        t.equals(writer1.length, 0)
        t.equals(writer2.length, 0)
      })
    })
  })
})

test('multifeed sync progress: 6 entries', function (t) {
  t.plan(9)

  setup(3, function (err, feed1, writer1) {
    t.error(err)
    setup(3, function (err, feed2, writer2) {
      t.error(err)

      var a = sync(feed1, { live: false })
      var b = sync(feed2, { live: false })

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

test('multifeed sync progress: 200 entries', function (t) {
  t.plan(11)

  setup(100, function (err, feed1, writer1) {
    t.error(err)
    setup(100, function (err, feed2, writer2) {
      t.error(err)

      var a = sync(feed1, { live: false })
      var b = sync(feed2, { live: false })

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
