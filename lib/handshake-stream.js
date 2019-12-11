const once = require('once')

function noop () {}

module.exports = function (stream, payload, handlers) {
  onpayload = once(handlers.onpayload || noop)
  // onpayload = handlers.onpayload || noop
  onresponse = once(handlers.onresponse || noop)
  onaccept = once(handlers.onaccept || noop)

  let payloadReceived = false
  let localResponded = false
  let remoteResponded = false
  let localAccept, remoteAccept

  const id = String(Math.random()).slice(2, 6)

  const hypercoreHandlers = {
    encoding: 'json',

    onerror: function (err) {
      stream.emit('error', err)
    },

    onmessage: function (msg) {
      switch (msg.type) {
        case 'payload':
          if (payloadReceived) {
            stream.emit('error', new Error('received a handshake payload more than once'))
            return
          }
          payloadReceived = true
          console.log(id, 'got payload')
          const onUserResponse = once((err, accept) => {
            if (err) return stream.emit('error', err)
            handshakeExt.send({type: 'response', accept: accept})
            localAccept = accept
            localResponded = true
            console.log(id, 'got local response + sent it')
            if (remoteResponded && localResponded) onaccept(localAccept, remoteAccept)
          })
          onpayload(msg.data, onUserResponse)
          break;
        case 'response':
          if (!payloadReceived) {
            stream.emit('error', new Error('received handshake response before payload'))
            return
          }
          if (remoteResponded) {
            stream.emit('error', new Error('received handshake response multiple times'))
            return
          }
          console.log(id, 'got remote response')
          remoteResponded = true
          remoteAccept = msg.accept
          onresponse(remoteAccept)
          if (remoteResponded && localResponded) onaccept(localAccept, remoteAccept)
          break;
        default:
          stream.emit('error', new Error('unknown message received (' + JSON.stringify(msg) + ')'))
          break;
      }
    }
  }

  const handshakeExt = stream.registerExtension('handshake', hypercoreHandlers)
  handshakeExt.send({type: 'payload', data: payload})
}
