#!/bin/bash

DOCKER_TLS_PORT=2376

function docker-refresh-port-forwards () {
    curl -q -m 3 localhost:${DOCKER_TLS_PORT}/fwd/refresh &>/dev/null
}

function docker-forward-kill () {
    curl -q -m 3 localhost:${DOCKER_TLS_PORT}/fwd/kill &>/dev/null
}

function docker-forward-pid () {
    curl -q -m 3 localhost:${DOCKER_TLS_PORT}/fwd/pid 2>/dev/null
}

function docker-forward-ports () {
    curl -q -m 3 localhost:${DOCKER_TLS_PORT}/fwd/ports 2>/dev/null
}

function docker-start-port-forward-manager () {
FWD_SERVER_JS=$(
cat << EOF
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
	var req = https.request({
		hostname : dockerHost,
		port : dockerSslPort,
		path : "/containers/json?all=1",
		method : "GET",
		cert : dockerTlsCert,
		key : dockerTlsKey,
		ca : dockerTlsCa,
		rejectUnauthorized : false
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
	});
	req.on("error", function(err) {
		switch (err.message) {
			case "connect ETIMEDOUT":
			case "connect ECONNREFUSED":
				// try again in a few seconds
				setTimeout(function() {
					getAllContainers(callback);
				}, 3000);
				break;
			default:
				console.log(err);
				break;
		}
	});
	req.end();
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
				// try updating multiple times
				setTimeout(updatePorts, 3000);
				setTimeout(updatePorts, 6000);
				setTimeout(updatePorts, 9000);
				setTimeout(updatePorts, 12000);
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
		ca : dockerTlsCa,
		rejectUnauthorized : false
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

EOF
)
    docker-forward-kill
    DOCKER_HOST="$(docker-host)" \
    DOCKER_CERT_PATH="$(cygpath -w $HOME/.docker)" \
    DOCKER_TLS_PORT="$DOCKER_TLS_PORT" \
        node -e "$FWD_SERVER_JS" &
}

case "$1" in
    fwd)
        SHELL_DOCKER_FWD_SUBACTION="$1"
        shift
        case "$SHELL_DOCKER_FWD_SUBACTION" in
            pid)
                docker-forward-pid
            ;;
            ports)
                docker-forward-ports
            ;;
            published)
                docker-ssh 'for x in $(docker ps -q); do docker port $x; done'
            ;;
            reload)
                docker-refresh-port-forwards
            ;;
            start)
                docker-start-port-forward-manager
            ;;
            stop)
                docker-forward-kill
            ;;
            *)
                exit 1
            ;;
        esac
    ;;
esac
