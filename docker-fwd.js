"use strict";

var child_process = require("child_process"),
	activeTunnel = null,
	activePorts = [];

function killActiveTunnel() {
	if (activeTunnel) {
		activeTunnel.kill("SIGINT");
		activeTunnel = null;
	}
}

function hasDiff(arr1, arr2) {
	return arr1.filter(function(i) {return !(arr2.indexOf(i) > -1);}).length > 0 ||
		arr2.filter(function(i) {return !(arr1.indexOf(i) > -1);}).length > 0;
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
		stdout.replace(/\d+\/\w+ -> \d+.\d+.\d+.\d+:(\d+)/g, function(m, p) {
			ports.push(+p);
		});
		if (!hasDiff(activePorts, ports)) {
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

setTimeout(updatePorts, 5000);
process.on("exit", killActiveTunnel);
require("http").createServer(function(request, response) {
	setTimeout(updatePorts, 5000);
	response.end("");
}).listen(59145, "localhost");
