"use strict";

var child_process = require("child_process"),
	activeTunnel = null,
	activePorts = [],
	portmapRegex = /^\d+\/\w+ -> \d+.\d+.\d+.\d+:(\d+)$/;

process.on("exit", killActiveTunnel);

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
		if (err || !stdout.trim()) {
			return;
		}
		var ports = stdout.split("\n")
			.reduce(function(p, c) {
				c = c.trim();
				if (!c || !portmapRegex.test(c)) {
					return p;
				}
				p.push(parseInt(portmapRegex.exec(c)[1], 10));
				return p;
			}, [])
			.sort();

		if (!hasDiff(activePorts, ports)) {
			return;
		}
		killActiveTunnel();
		var args = [
			"-N",
			"-o", "UserKnownHostsFile=/dev/null",
			"-o", "StrictHostKeyChecking=no"
		];
		ports.forEach(function(p) {
			args.push("-L", p + ":" + process.env.BOOT2DOCKER_HOST + ":" + p);
		});
		args.push("docker@" + process.env.BOOT2DOCKER_HOST);
		activeTunnel = child_process.spawn("ssh", args);
		activePorts = ports;
	});
}

updatePorts();

require("http").createServer(function(request, response) {
	response.writeHead(200, {"Content-Type": "text/plain"});
	updatePorts();
	response.write("");
	response.end();
}).listen(59145, "localhost");
