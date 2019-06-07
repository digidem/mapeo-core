var test = require('tape')
var collect = require('collect-stream')
var cloneDeep = require('clone-deep')

var helpers = require('./helpers')

var obs = {
  attachments: [],
  type: 'observation',
  lat: 0.1,
  lon: 0.2,
  tags: {
    'foo': 'bar'
  }
}

var obs2 = {
  type: 'observation',
  lat: 0.15,
  lon: 0.25,
  tags: {
    'foo': 'baz'
  }
}

test('observationCreate', function (t) {
  var mapeo = helpers.createApi(helpers.tmpdir1)
  mapeo.observationCreate(obs, (err, node) => {
    t.error(err)
    t.ok(node.id)
    t.ok(node.version)
    t.same(node.lat, obs.lat)
    t.same(node.lon, obs.lon)
    t.same(obs.tags, node.tags)
    mapeo.observationGet(node.id, (err, _node) => {
      t.error(err)
      delete node.timestamp
      delete _node[0].timestamp
      t.same(node, _node[0])
      t.end()
    })
  })
})

test('observationUpdate', function (t) {
  var mapeo = helpers.createApi(helpers.tmpdir1)
  mapeo.observationCreate(obs, (err, node) => {
    t.error(err)
    var newObs = cloneDeep(obs2)
    newObs.version = node.version
    newObs.id = node.id
    mapeo.observationUpdate(newObs, (err, updated) => {
      t.error(err)
      t.same(newObs.lat, updated.lat, 'updates lat and lon')
      t.same(newObs.lon, updated.lon, 'updates lat and lon')
      t.same(newObs.tags, updated.tags, 'updates tags')
      t.notEqual(updated.version, node.version, 'updates version')
      t.end()
    })
  })
})

test('update many and then list', function (t) {
  var mapeo = helpers.createApi(helpers.tmpdir1)
  var i = 200

  createAndUpdate(i, done)

  function createAndUpdate (total, cb) {
    helpers.generateObservations(i, function (_, obs) {
      mapeo.observationCreate(obs, (_, node) => {
        var newObs = cloneDeep(node)
        newObs.tags.notes = 'im a new tag'
        mapeo.observationUpdate(newObs, (_, updated) => {
          total--
          if (total === 0) return cb()
        })
      })
    })
  }

  function done () {
    mapeo.observationList((err, list) => {
      t.error(err)
      t.same(list.length, i)
      t.end()
    })
  }
})

test('observationList', function (t) {
  var mapeo = helpers.createApi(helpers.tmpdir1)
  mapeo.observationCreate(obs, (err, node1) => {
    t.error(err)
    mapeo.observationList((err, list) => {
      t.error(err)
      var newObs = cloneDeep(obs2)
      t.equal(list.length, 1, 'contains 1 item')
      mapeo.observationCreate(newObs, (err, node2) => {
        t.error(err)
        mapeo.observationList((err, list) => {
          t.error(err)
          t.equal(list.length, 2, 'contains 2 items')
          var match1 = list.find((n) => n.id === node1.id)
          t.same(match1.id, node1.id, 'contains node1 in list')
          var match2 = list.find((n) => n.id === node2.id)
          t.same(match2.id, node2.id, 'contains node2 in list')
          t.end()
        })
      })
    })
  })
})

test('observationList with limit=1', function (t) {
  var mapeo = helpers.createApi(helpers.tmpdir1)
  mapeo.observationCreate(obs, (err, node1) => {
    t.error(err)
    mapeo.observationList((err, list) => {
      t.error(err)
      var newObs = cloneDeep(obs2)
      t.equal(list.length, 1, 'contains 1 item')
      mapeo.observationCreate(newObs, (err, node2) => {
        t.error(err)
        mapeo.observationList({limit: 1}, (err, list) => {
          t.error(err)
          t.equal(list.length, 1, 'contains 1 item with limit=1')
          t.end()
        })
      })
    })
  })
})

test('observationDelete', function (t) {
  var mapeo = helpers.createApi(helpers.tmpdir1)
  mapeo.observationCreate(obs, (err, node) => {
    t.error(err)
    mapeo.observationDelete(node.id, (err) => {
      t.error(err)
      mapeo.observationGet(node.id, (err, ret) => {
        t.error(err)
        t.same(ret.length, 1, 'returns a list')
        var node2 = ret[0]
        t.same(node2.id, node.id, 'id the same')
        t.notEqual(node2.version, node.version, 'updated version')
        t.same(node2.deleted, true, 'marked deleted')
        mapeo.observationList((err, list) => {
          t.error(err)
          var deleted = list.filter((o) => o.id === node.id)
          t.same(deleted.length, 0, 'deleted not returned in list')
          t.end()
        })
      })
    })
  })
})

test('observationDelete with media', function (t) {
  var mapeo = helpers.createApi(helpers.tmpdir1)
  var ws = mapeo.media.createWriteStream('original/hello.txt')
  ws.end('world')
  ws.on('end', (err) => {
    t.error(err)
    var mediaObs = cloneDeep(obs)
    mediaObs.attachments.push({
      id: 'hello.txt'
    })
    mapeo.observationCreate(mediaObs, (err, node) => {
      t.error(err)
      mapeo.observationDelete(node.id, (err) => {
        t.error(err)
        mapeo.media.list((err, files) => {
          t.error(err)
          t.deepEquals(files, [], 'all media deleted')
          mapeo.observationGet(node.id, (err, ret) => {
            t.error(err)
            t.same(ret.length, 1, 'returns a list')
            var node2 = ret[0]
            t.same(node2.id, node.id, 'id the same')
            t.notEqual(node2.version, node.version, 'updated version')
            t.same(node2.deleted, true, 'marked deleted')
            mapeo.observationList((err, list) => {
              t.error(err)
              var deleted = list.filter((o) => o.id === node.id)
              t.same(deleted.length, 0, 'deleted not returned in list')
              t.end()
            })
          })
        })
      })
    })
  })
})

test('observationDelete with forked obsevations + media', function (t) {
  var mapeo = helpers.createApi(helpers.tmpdir1)
  var ws = mapeo.media.createWriteStream('original/hello.txt')
  ws.end('world')
  ws.on('end', (err) => {
    t.error(err)
    var mediaObs = cloneDeep(obs)
    mediaObs.attachments.push({
      id: 'hello.txt'
    })
    mapeo.observationCreate(mediaObs, (err, node) => {
      t.error(err)
      var obs3 = cloneDeep(obs2)
      Object.assign(obs3, {
        attachments: [ { id: 'goodbye.txt' } ]
      })
      mapeo.osm.put(node.id, obs3, {links:[]}, (err, node2) => {
        t.error(err)
        mapeo.observationDelete(node.id, (err) => {
          t.error(err)
          mapeo.media.list((err, files) => {
            t.error(err)
            t.deepEquals(files, [], 'all media deleted')
            mapeo.observationGet(node.id, (err, ret) => {
              t.error(err)
              t.same(ret.length, 1, 'returns a list')
              var node2 = ret[0]
              t.same(node2.id, node.id, 'id the same')
              t.notEqual(node2.version, node.version, 'updated version')
              t.same(node2.deleted, true, 'marked deleted')
              mapeo.observationList((err, list) => {
                console.log(list)
                t.error(err)
                var deleted = list.filter((o) => o.id === node.id)
                t.same(deleted.length, 0, 'deleted not returned in list')
                t.end()
              })
            })
          })
        })
      })
    })
  })
})

test('observationStream', function (t) {
  t.plan(4)
  var mapeo = helpers.createApi(helpers.tmpdir1)
  mapeo.observationCreate(obs, (err, node1) => {
    t.error(err)
    var newObs = cloneDeep(obs2)
    mapeo.observationCreate(newObs, (err, node2) => {
      t.error(err)
      var pending = 2
      mapeo.observationStream().on('data', function (obs) {
        pending--
        delete obs.timestamp
        delete node1.timestamp
        delete node2.timestamp
        if (obs.id === node1.id) t.same(obs, node1, 'obs 1 arrives')
        if (obs.id === node2.id) t.same(obs, node2, 'obs 2 arrives')
      })
    })
  })
})

test('observationStream with forked obsevations', function (t) {
  var mapeo = helpers.createApi(helpers.tmpdir1)
  var ws = mapeo.media.createWriteStream('original/hello.txt')
  ws.end('world')
  ws.on('end', (err) => {
    t.error(err)
    var obsA = cloneDeep(obs)
    mapeo.observationCreate(obsA, (err, node1) => {
      t.error(err)
      // create two new observations based on the original -- creates fork
      var obsB = cloneDeep(node1)
      obsB.tags.foo = 'baz'
      mapeo.osm.put(obsB.id, obsB, {links: [node1.version]}, (err, node2) => {
        t.error(err)
        var obsC = cloneDeep(node2)
        obsC.tags.foo = 'qux'
        mapeo.osm.put(obsC.id, obsC, {links: [node1.version]}, (err, node3) => {
          t.error(err)
          onForksCreated(node1, node2, node3)
        })
      })
    })
  })
  function onForksCreated (original, fork1, fork2) {
    // Just checking we set up the test correctly
    t.equal(fork1.links[0], original.version, 'fork1 links to original')
    t.equal(fork2.links[0], original.version, 'fork2 links to original')
    mapeo.observationList({forks: true}, (err, list) => {
      t.error(err)
      t.equal(list.length, 2, 'list without forks=true returns all forks')
      t.ok(list.some(n => n.version === fork1.version), 'list includes fork1')
      t.ok(list.some(n => n.version === fork2.version), 'list includes fork2')
      t.ok(!list.some(n => n.version === original.version), 'list does not include original')
      mapeo.observationList((err, deforkedList) => {
        t.error(err)
        t.equal(deforkedList.length, 1, 'list without forks opt only returns 1 fork')
        t.ok(deforkedList.some(n => n.version === fork2.version), 'list includes fork2')
        t.ok(!deforkedList.some(n => n.version === fork1.version), 'list does not include fork1')
        t.ok(!deforkedList.some(n => n.version === original.version), 'list does not include original')
        t.end()
      })
    })
  }
})

test('observationStream with options', function (t) {
  t.plan(4)
  var mapeo = helpers.createApi(helpers.tmpdir1)
  mapeo.observationCreate(obs, (err, node1) => {
    t.error(err)
    var newObs = cloneDeep(obs2)
    mapeo.observationCreate(newObs, (err, node2) => {
      t.error(err)
      collect(mapeo.observationStream({limit: 1}), (err, data) => {
        t.error(err)
        t.ok(data.length, 1)
      })
    })
  })
})
