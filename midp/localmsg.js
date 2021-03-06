/* -*- Mode: Java; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/* vim: set shiftwidth=4 tabstop=4 autoindent cindent expandtab: */

'use strict';

var LocalMsgConnection = function() {
    this.waitingForConnection = null;
    this.serverWaiting = null;
    this.clientWaiting = null;
    this.serverMessages = [];
    this.clientMessages = [];
}

LocalMsgConnection.prototype.notifyConnection = function() {
    if (this.waitingForConnection) {
        this.waitingForConnection();
    }
}

LocalMsgConnection.prototype.waitConnection = function(ctx) {
    this.waitingForConnection = function() {
        this.waitingForConnection = null;
        ctx.resume();
    }

    throw VM.Pause;
}

LocalMsgConnection.prototype.copyMessage = function(messageQueue, data) {
    var msg = messageQueue.shift();

    for (var i = 0; i < msg.length; i++) {
        data[i] = msg.data[i + msg.offset];
    }

    return msg.length;
}

LocalMsgConnection.prototype.sendMessageToClient = function(message) {
    this.clientMessages.push(message);

    if (this.clientWaiting) {
        this.clientWaiting();
    }
}

LocalMsgConnection.prototype.clientReceiveMessage = function(ctx, stack, data) {
    if (this.clientMessages.length == 0) {
        this.clientWaiting = function() {
            this.clientWaiting = null;

            stack.push(this.copyMessage(this.clientMessages, data));

            ctx.resume();
        }

        throw VM.Pause;
    }

    stack.push(this.copyMessage(this.clientMessages, data));
}

LocalMsgConnection.prototype.sendMessageToServer = function(message) {
    this.serverMessages.push(message);

    if (this.serverWaiting) {
        this.serverWaiting();
    }
}

LocalMsgConnection.prototype.serverReceiveMessage = function(ctx, stack, data) {
    if (this.serverMessages.length == 0) {
        this.serverWaiting = function() {
            this.serverWaiting = null;

            stack.push(this.copyMessage(this.serverMessages, data));

            ctx.resume();
        }

        throw VM.Pause;
    }

    stack.push(this.copyMessage(this.serverMessages, data));
}

MIDP.LocalMsgConnections = {};

// Add some fake servers because some MIDlets assume they exist.
// MIDlets are usually happy even if the servers don't reply, but we should
// remember to implement them in case they will be needed.
MIDP.FakeLocalMsgServers = [ "nokia.phone-status", "nokia.active-standby", "nokia.profile",
                             "nokia.connectivity-settings", "nokia.contacts",
                             "nokia.messaging" ];
MIDP.FakeLocalMsgServers.forEach(function(server) {
    MIDP.LocalMsgConnections[server] = new LocalMsgConnection();
});

Native["org/mozilla/io/LocalMsgConnection.init.(Ljava/lang/String;)V"] = function(ctx, stack) {
    var name = util.fromJavaString(stack.pop()), _this = stack.pop();

    _this.server = (name[2] == ":");
    _this.protocolName = name.slice((name[2] == ':') ? 3 : 2);

    if (_this.server) {
        MIDP.LocalMsgConnections[_this.protocolName] = new LocalMsgConnection();
        pushNotify("localmsg:" + _this.protocolName);
    } else {
        // Actually, there should always be a server, but we need this check
        // for apps that use the Nokia built-in servers (because we haven't
        // implemented them yet).
        if (!MIDP.LocalMsgConnections[_this.protocolName]) {
            console.warn("localmsg server (" + _this.protocolName + ") unimplemented");
            throw VM.Pause;
        }

        if (MIDP.FakeLocalMsgServers.indexOf(_this.protocolName) != -1) {
            console.warn("connect to an unimplemented localmsg server (" + _this.protocolName + ")");
        }

        MIDP.LocalMsgConnections[_this.protocolName].notifyConnection();
    }
}

Native["org/mozilla/io/LocalMsgConnection.waitConnection.()V"] = function(ctx, stack) {
    var _this = stack.pop();

    MIDP.LocalMsgConnections[_this.protocolName].waitConnection(ctx);
}

Native["org/mozilla/io/LocalMsgConnection.sendData.([BII)V"] = function(ctx, stack) {
    var length = stack.pop(), offset = stack.pop(), data = stack.pop(), _this = stack.pop();

    var message = {
      data: data,
      offset: offset,
      length: length,
    };

    if (_this.server) {
        MIDP.LocalMsgConnections[_this.protocolName].sendMessageToClient(message);
    } else {
        if (MIDP.FakeLocalMsgServers.indexOf(_this.protocolName) != -1) {
            console.warn("sendData (" + util.decodeUtf8(new Uint8Array(data.buffer, offset, length)) + ") to an unimplemented localmsg server (" + _this.protocolName + ")");
        }

        MIDP.LocalMsgConnections[_this.protocolName].sendMessageToServer(message);
    }
}

Native["org/mozilla/io/LocalMsgConnection.receiveData.([B)I"] = function(ctx, stack) {
    var data = stack.pop(), _this = stack.pop();

    if (_this.server) {
        MIDP.LocalMsgConnections[_this.protocolName].serverReceiveMessage(ctx, stack, data);
    } else {
        if (MIDP.FakeLocalMsgServers.indexOf(_this.protocolName) != -1) {
            console.warn("receiveData from an unimplemented localmsg server (" + _this.protocolName + ")");
        }

        MIDP.LocalMsgConnections[_this.protocolName].clientReceiveMessage(ctx, stack, data);
    }
}

Native["org/mozilla/io/LocalMsgConnection.closeConnection.()V"] = function(ctx, stack) {
    var _this = stack.pop()

    if (_this.server) {
        delete MIDP.LocalMsgConnections[_this.protocolName];
    }
}
