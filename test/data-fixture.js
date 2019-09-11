var clone = require('clone')

function json2batch (data) {
  return data.map((e) => {
    e = clone(e)
    var op = {
      type: 'put',
      key: e.id,
      id: e.id,
      value: e
    }
    if (e.nodes) e.refs = e.nodes
    delete e.id
    delete e.nodes
    return op
  })
}

module.exports = {
  node: {
    batch: json2batch([
      {
        type: 'node',
        id: 1,
        lat: 1.234,
        lon: 4.321,
        tags: {
          interesting: 'this is'
        }
      }
    ]),
    expected: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            interesting: 'this is'
          },
          geometry: {
            type: 'Point',
            coordinates: [4.321, 1.234]
          }
        }
      ]
    }
  },
  way: {
    batch: json2batch([
      {
        type: 'way',
        id: 'A',
        tags: {
          interesting: 'this is'
        },
        nodes: ['B', 'C', 'D']
      },
      {
        type: 'node',
        id: 'B',
        lat: 0.0,
        lon: 1.0
      },
      {
        type: 'node',
        id: 'C',
        lat: 0.0,
        lon: 1.1
      },
      {
        type: 'node',
        id: 'D',
        lat: 0.1,
        lon: 1.2
      }
    ]),
    expected: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            interesting: 'this is'
          },
          geometry: {
            type: 'LineString',
            coordinates: [
              [1.0, 0.0],
              [1.1, 0.0],
              [1.2, 0.1]
            ]
          }
        }
      ]
    }
  },
  polygon: {
    batch: json2batch([
      {
        type: 'way',
        id: 'A',
        nodes: ['B', 'C', 'D', 'E', 'B'],
        tags: {area: 'yes'}
      },
      {
        type: 'node',
        id: 'B',
        lat: 0.0,
        lon: 0.0
      },
      {
        type: 'node',
        id: 'C',
        lat: 0.0,
        lon: 1.0
      },
      {
        type: 'node',
        id: 'D',
        lat: 1.0,
        lon: 1.0
      },
      {
        type: 'node',
        id: 'E',
        lat: 1.0,
        lon: 0.0
      }
    ]),
    expected: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            area: 'yes'
          },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [0.0, 0.0],
              [1.0, 0.0],
              [1.0, 1.0],
              [0.0, 1.0],
              [0.0, 0.0]
            ]]
          }
        }
      ]
    }
  }
}
module.exports.json2batch = json2batch
