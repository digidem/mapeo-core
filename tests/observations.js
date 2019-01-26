var test = require('tape')
var helpers = require('./helpers')
var core = require('..')

var obs = {
  attachments: [],
  type: 'observation',
  lat: 0.1,
  lon: 0.2,
  tags: [{
    'foo': 'bar'
  }]
}

var obs2 = {
  type: 'observation',
  lat: 0.15,
  lon: 0.25,
  tags: [{
    'foo': 'baz'
  }]
}

test('observationCreate', function (t) {
  var m = helpers.createStore(helpers.tmpdir)
  m.observationCreate(obs, (err, node) => {
    t.error(err)
    t.ok(node.id)
    t.ok(node.version)
    t.same(node.lat, obs.lat)
    t.same(node.lon, obs.lon)
    t.same(obs.tags, node.tags)
    m.observationGet(node.id, (err, _node) => {
      t.error(err)
      t.same(node, _node[0])
      helpers.cleanup()
      t.end()
    })
  })
})

test('observationUpdate', function (t) {
  var m = helpers.createStore(helpers.tmpdir)
  m.observationCreate(obs, (err, node) => {
    t.error(err)
    var newObs = Object.assign(obs2, {})
    newObs.version = node.version
    newObs.id = node.id
    m.observationUpdate(newObs, (err, updated) => {
      t.error(err)
      t.same(newObs.lat, updated.lat, 'updates lat and lon')
      t.same(newObs.lon, updated.lon, 'updates lat and lon')
      t.same(newObs.tags, updated.tags, 'updates tags')
      t.notEqual(updated.version, node.version, 'updates version')
      helpers.cleanup()
      t.end()
    })
  })
})

test('observationList', function (t) {
  var m = helpers.createStore(helpers.tmpdir)
  m.observationCreate(obs, (err, node1) => {
    t.error(err)
    m.observationList((err, list) => {
      t.error(err)
      var newObs = Object.assign(obs2, {})
      t.equal(list.length, 1, 'contains 1 item')
      m.observationCreate(newObs, (err, node2) => {
        t.error(err)
        m.observationList((err, list) => {
          t.error(err)
          t.equal(list.length, 2, 'contains 2 items')
          var match1 = list.find((n) => n.id === node1.id)
          t.same(match1.id, node1.id, 'contains node1 in list')
          var match2 = list.find((n) => n.id === node2.id)
          t.same(match2.id, node2.id, 'contains node2 in list')
          helpers.cleanup()
          t.end()
        })
      })
    })
  })
})

test('observationDelete', function (t) {
  var m = helpers.createStore(helpers.tmpdir)
  m.observationCreate(obs, (err, node) => {
    t.error(err)
    m.observationDelete(node.id, (err) => {
      t.error(err)
      m.observationGet(node.id, (err, ret) => {
        t.error(err)
        t.same(ret.length, 1, 'returns a list')
        var node2 = ret[0]
        t.same(node2.id, node.id, 'id the same')
        t.notEqual(node2.version, node.version, 'updated version')
        t.same(node2.deleted, true, 'marked deleted')
        helpers.cleanup()
        t.end()
      })
    })
  })
})

test('observationStream', function (t) {
  t.plan(4)
  var m = helpers.createStore(helpers.tmpdir)
  m.observationCreate(obs, (err, node1) => {
    t.error(err)
    var newObs = Object.assign(obs2, {})
    m.observationCreate(newObs, (err, node2) => {
      t.error(err)
      var pending = 2
      m.observationStream().on('data', function (obs) {
        pending--
        if (!pending) {
          helpers.cleanup()
        }
        if (obs.id === node1.id) t.same(obs, node1, 'obs 1 arrives')
        if (obs.id === node2.id) t.same(obs, node2, 'obs 2 arrives')
      })
    })
  })
})
