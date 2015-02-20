"use strict";

var child_process = require("child_process"),
    activeTunnel = null,
    activePorts = [],
    dockerPort = 2375,
    dockerSslPort = 2376;
function killActiveTunnel() {
    if (activeTunnel) {
        activeTunnel.kill("SIGINT");
        activeTunnel = null;
        activePorts = [];
    }
}
function updatePorts() {
    child_process.exec("bash docker forwarded-ports", function(err, stdout, stderr) {
        if (stderr) {
            process.stderr.write(stderr);
        }
        if (err) {
            return;
        }
        var ports = [];
        ports.push(dockerPort);
        ports.push(dockerSslPort);
        stdout.replace(/\d+\/\w+ -> \d+.\d+.\d+.\d+:(\d+)/g, function(m, p) {
            ports.push(+p);
        });
        if (activePorts.sort().join(",") === ports.sort().join(",")) {
            return;
        }
        killActiveTunnel();
        var args = [
            "-N",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "StrictHostKeyChecking=no",
            "-o", "ConnectTimeout=2"
        ];
        ports.forEach(function(p) {
            args.push("-L", p + ":" + process.env.BOOT2DOCKER_HOST + ":" + p);
        });
        args.push("docker@" + process.env.BOOT2DOCKER_HOST);
        activeTunnel = child_process.spawn("ssh", args);
        activePorts = ports;
    });
}
setTimeout(updatePorts, 3000);
process.on("exit", killActiveTunnel);
require("http")
    .createServer(function(request, response) {
        switch (request.url) {
            case "/ports":
                response.write(activePorts.join("\n"));
                break;
            case "/child":
                if (activeTunnel) {
                    response.write(activeTunnel.pid + "");
                }
                break;
            case "/child/kill":
                killActiveTunnel();
                break;
            case "/pid":
                response.write(process.pid + "");
                break;
            case "/kill":
                process.nextTick(function() {
                    process.exit(0);
                });
                break;
            case "/":
            default:
                setTimeout(updatePorts, 3000);
                break;
        }
        response.end("");
    })
    .listen(process.env.FORWARDS_SERVER_PORT, "localhost");
