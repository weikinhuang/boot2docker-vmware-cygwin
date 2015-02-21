"use strict";

var child_process = require("child_process"),
	fs = require("fs"),
	http = require("http"),
	https = require("https"),
	path = require("path"),
	activeTunnel = null,
	activePorts = [],
	dockerHost = process.env.DOCKER_HOST,
	dockerSslPort = process.env.DOCKER_TLS_PORT || 2376,
	dockerTlsCa = fs.readFileSync(path.join(process.env.DOCKER_CERT_PATH, "ca.pem")),
	dockerTlsCert = fs.readFileSync(path.join(process.env.DOCKER_CERT_PATH, "cert.pem")),
	dockerTlsKey = fs.readFileSync(path.join(process.env.DOCKER_CERT_PATH, "key.pem"));
function killActiveTunnel() {
	if (activeTunnel) {
		activeTunnel.kill("SIGINT");
		activeTunnel = null;
		activePorts = [];
	}
}
function getAllContainers(callback) {
	https.request({
		hostname : dockerHost,
		port : dockerSslPort,
		path : "/containers/json?all=1",
		method : "GET",
		cert : dockerTlsCert,
		key : dockerTlsKey,
		ca : dockerTlsCa
	}, function(res) {
		var data = "";
		if (res.statusCode !== 200) {
			return;
		}
		res.on("data", function(d) {
			data += d;
		});
		res.on("end", function() {
			var containers;
			try {
				containers = JSON.parse(data);
			} catch (e) {
				process.stderr.write("Forward server error: " + e.message + "\n");
				return;
			}
			callback(containers);
		});
	}).end();
}
function updatePorts() {
	getAllContainers(function(containers) {
		var ports = [];
		containers.forEach(function(container) {
			(container.Ports || []).forEach(function(portgroup) {
				if (portgroup.PublicPort) {
					ports.push(portgroup.PublicPort);
				}
			});
		});
		if (activePorts.sort().join(",") === ports.sort().join(",")) {
			return;
		}
		killActiveTunnel();
		var args = [
			"-N",
			"-k",
			"-o", "UserKnownHostsFile=/dev/null",
			"-o", "StrictHostKeyChecking=no",
			"-o", "ConnectTimeout=2"
		];
		ports.forEach(function(p) {
			args.push("-L", p + ":" + dockerHost + ":" + p);
		});
		args.push("docker@" + dockerHost);
		activeTunnel = child_process.spawn("ssh", args);
		activePorts = ports;
	});
}
setTimeout(updatePorts, 3000);
process.on("exit", killActiveTunnel);
http.createServer(function(request, response) {
	if ((/^\/fwd\//i).test(request.url)) {
		switch (request.url) {
			case "/fwd/ports":
				response.write(activePorts.join("\n"));
				break;
			case "/fwd/child":
				if (activeTunnel) {
					response.write(activeTunnel.pid + "");
				}
				break;
			case "/fwd/child/kill":
				killActiveTunnel();
				break;
			case "/fwd/pid":
				response.write(process.pid + "");
				break;
			case "/fwd/kill":
				process.nextTick(function() {
					process.exit(0);
				});
				break;
			case "/fwd/refresh":
			default:
				setTimeout(updatePorts, 3000);
				break;
		}
		response.end("");
		return;
	}

	// pipe the request to the docker api in the b2d host
	var proxy = https.request({
		hostname : dockerHost,
		port : dockerSslPort,
		path : request.url,
		method : request.method,
		cert : dockerTlsCert,
		key : dockerTlsKey,
		ca : dockerTlsCa
	}, function(res) {
		res.pipe(response, {
			end : true
		});
	});
	request.pipe(proxy, {
		end : true
	});
})
	.listen(dockerSslPort, "localhost");
