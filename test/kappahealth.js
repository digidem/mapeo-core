function hyperhealth (feed) {
  if (feed.content) feed = feed.content

  function get () {
    if (!feed || !feed.peers) return
    feed.update()
    var length = feed.length
    var peers = []

    for (var i = 0; i < feed.peers.length; i++) {
      var have = 0
      var peer = feed.peers[i]
      if (!peer.stream || !peer.remoteId) continue

      for (var j = 0; j < length; j++) {
        if (peer.remoteBitfield && peer.remoteBitfield.get(j)) have++
      }
      var obj = {
        remoteId: peer.remoteId.toString('hex'),
        id: i,
        have: have,
        length: feed.length
      }
      peers.push(obj)
    }
    return {
      key: feed.key.toString('hex'),
      byteLength: feed.byteLength,
      length: feed.length,
      peers: peers
    }
  }

  return {
    get: get
  }
}

module.exports = function (core) {
  var healths = []
  core._logs.on('feed', function (feed) {
    healths.push(hyperhealth(feed))
  })
  function get () {
    return healths.map((h) => h.get())
  }

  return {
    get: get
  }
}
