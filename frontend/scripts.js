import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from "./lib/GLTFLoader.js";

let scene, camera, renderer, earth, controls;
let markers = new Map();

let pointLimit = 50;
let fadeTimeSeconds = 30;
let pointQueue = [];
let historicalPoints = [];

let raycaster, mouse;
let pointData = new Map();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    // Renderer setup with depth buffer
    renderer = new THREE.WebGLRenderer({
        antialias: true,
        logarithmicDepthBuffer: true
    });
    renderer.setSize(window.innerWidth - 400, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.sortObjects = true;
    document.getElementById('globe-container').appendChild(renderer.domElement);

    // Camera setup
    const aspect = (window.innerWidth - 400) / window.innerHeight;
    camera = new THREE.PerspectiveCamera(30, aspect, 0.1, 1000);
    camera.position.set(2.5, 0, 0);
    camera.lookAt(0, 0, 0);

    // OrbitControls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 1.5;
    controls.maxDistance = 4;
    controls.enableRotate = true;
    controls.rotateSpeed = 0.5;
    controls.enableZoom = true;
    controls.zoomSpeed = 0.5;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 1);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1);
    sunLight.position.set(5, 0, 5);
    scene.add(sunLight);

    createEarth();
    animate();
    window.addEventListener('resize', onWindowResize, false);

    // Setup raycaster for point interaction
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    renderer.domElement.addEventListener('mousemove', onMouseMove, false);
}

function createEarth() {
    const textureLoader = new THREE.TextureLoader();
    earth = new THREE.Mesh(
        new THREE.SphereGeometry(0.7, 64, 64),
        new THREE.MeshPhongMaterial({
            map: textureLoader.load('https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg'),
            normalMap: textureLoader.load('https://threejs.org/examples/textures/planets/earth_normal_2048.jpg'),
            specularMap: textureLoader.load('https://threejs.org/examples/textures/planets/earth_specular_2048.jpg'),
            normalScale: new THREE.Vector2(0.85, 0.85),
            transparent: false,
            depthWrite: true,
            depthTest: true
        })
    );
    earth.renderOrder = 0;
    scene.add(earth);
}

document.getElementById('pointLimit').addEventListener('input', function (e) {
    pointLimit = parseInt(e.target.value) || 50;
    cleanupMarkers();
});

document.getElementById('fadeTime').addEventListener('input', function (e) {
    const newFadeTime = parseInt(e.target.value) || 30;
    if (newFadeTime > fadeTimeSeconds) {
        restorePoints(newFadeTime);
    }
    fadeTimeSeconds = newFadeTime;
    cleanupMarkers();
});

// Just copypaste from the class solution from airplanes
function latLongToVector3(lat, lon, radius = 1) {
    const phi = THREE.MathUtils.degToRad(90 - lat);
    const theta = THREE.MathUtils.degToRad(lon + 90);
    return new THREE.Vector3().setFromSphericalCoords(radius, phi, theta);
}

function createMarker(lat, lon, isSuspicious = false) {
    const markerGroup = new THREE.Group();

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 16);
    gradient.addColorStop(0, isSuspicious ? '#ff2222' : '#22ff22');
    gradient.addColorStop(0.5, isSuspicious ? 'rgba(255, 0, 0, 0.5)' : 'rgba(0, 255, 0, 0.5)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.beginPath();
    ctx.arc(32, 32, 16, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    const markerMaterial = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 1,
        depthTest: true,
        depthWrite: false,
        renderOrder: 1
    });

    const marker = new THREE.Sprite(markerMaterial);
    marker.scale.set(0.03, 0.03, 1);

    const beamGeometry = new THREE.CylinderGeometry(0.015, 0.001, 0.08, 8, 1, true);
    const beamMaterial = new THREE.MeshBasicMaterial({
        color: isSuspicious ? 0xff3333 : 0x33ff33,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    const beam = new THREE.Mesh(beamGeometry, beamMaterial);

    const surfacePosition = latLongToVector3(lat, lon, 0.702);
    const outwardPosition = latLongToVector3(lat, lon, 1.0);

    markerGroup.position.copy(surfacePosition);

    markerGroup.lookAt(outwardPosition);
    beam.rotation.x = Math.PI / 2;

    markerGroup.add(marker);
    markerGroup.add(beam);

    return markerGroup;
}

function restorePoints(newFadeTime) {
    const now = Date.now();
    const newMaxAge = newFadeTime * 1000;

    const pointsToRestore = historicalPoints.filter(point => {
        const age = now - point.timestamp;
        return age <= newMaxAge && !markers.has(point.key);
    });

    pointsToRestore.sort((a, b) => a.timestamp - b.timestamp);

    pointsToRestore.forEach(point => {
        if (pointQueue.length < pointLimit) {
            const markerGroup = createMarker(point.lat, point.lon, point.isSuspicious);
            scene.add(markerGroup);
            const markerData = {
                group: markerGroup,
                count: point.count,
                timestamp: point.timestamp,
                isSuspicious: point.isSuspicious,
                key: point.key
            };

            const beam = markerGroup.children[1];
            const heightScale = Math.min(1 + (point.count * 0.3), 4);
            beam.scale.set(1, heightScale, 1);
            beam.material.opacity = Math.min(0.4 + (point.count * 0.01), 0.5);

            markers.set(point.key, markerData);
            pointQueue.push(point.key);
        }
    });
}

function updateMarker(lat, lon, isSuspicious = false, packageData = null) {
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;

    if (packageData) {
        const now = Date.now();
        pointData.set(key, {
            ...packageData,
            latitude: lat,
            longitude: lon,
            suspicious: isSuspicious,
            timestamp: now
        });
    } else {
        pointData.set(key, {
            latitude: lat,
            longitude: lon,
            suspicious: isSuspicious,
            timestamp: Date.now(),
            ip: "Unknown"
        });
    }

    const historicalPoint = historicalPoints.find(p => p.key === key);
    if (historicalPoint) {
        historicalPoint.count++;
        historicalPoint.timestamp = Date.now();
        historicalPoint.isSuspicious = historicalPoint.isSuspicious || isSuspicious;
    } else {
        historicalPoints.push({
            key,
            lat,
            lon,
            count: 1,
            timestamp: Date.now(),
            isSuspicious
        });
    }

    if (!markers.has(key)) {
        const markerGroup = createMarker(lat, lon, isSuspicious);
        scene.add(markerGroup);
        const markerData = {
            group: markerGroup,
            count: 1,
            timestamp: Date.now(),
            isSuspicious,
            key: key
        };
        markers.set(key, markerData);
        pointQueue.push(key);

        while (pointQueue.length > pointLimit) {
            const oldestKey = pointQueue.shift();
            if (markers.has(oldestKey)) {
                const oldMarker = markers.get(oldestKey);
                scene.remove(oldMarker.group);
                markers.delete(oldestKey);
            }
        }
    } else {
        const markerData = markers.get(key);
        markerData.count++;
        markerData.timestamp = Date.now();

        const beam = markerData.group.children[1];
        const heightScale = Math.min(1 + (markerData.count * 0.3), 4);
        beam.scale.set(1, heightScale, 1);
        beam.material.opacity = Math.min(0.4 + (markerData.count * 0.01), 0.5);

        if (isSuspicious && !markerData.isSuspicious) {
            markerData.isSuspicious = true;
            const newMarkerGroup = createMarker(lat, lon, true);
            newMarkerGroup.children[1].scale.y = beam.scale.y;
            newMarkerGroup.children[1].material.opacity = beam.material.opacity;
            scene.remove(markerData.group);
            scene.add(newMarkerGroup);
            markerData.group = newMarkerGroup;
        }
    }
}

function cleanupMarkers() {
    const now = Date.now();
    const maxAge = fadeTimeSeconds * 1000;
    const fadeStart = maxAge * 0.8;

    pointQueue = pointQueue.filter(key => {
        const data = markers.get(key);
        if (!data) return false;

        const age = now - data.timestamp;
        if (age > maxAge) {
            scene.remove(data.group);
            markers.delete(key);
            return false;
        } else if (age > fadeStart) {
            const fadeProgress = (age - fadeStart) / (maxAge - fadeStart);
            data.group.children.forEach(child => {
                if (child.material) {
                    const baseOpacity = child === data.group.children[0] ? 1 : 0.4;
                    child.material.opacity = baseOpacity * (1 - fadeProgress);
                }
            });
        }
        return true;
    });

    const maxHistoricalAge = 3600000;
    historicalPoints = historicalPoints.filter(point =>
        (now - point.timestamp) <= maxHistoricalAge
    );

    pointData.forEach((data, key) => {
        const marker = markers.get(key);
        if (!marker && (now - data.timestamp) > maxHistoricalAge) {
            pointData.delete(key);
        }
    });

    while (pointQueue.length > pointLimit) {
        const oldestKey = pointQueue.shift();
        if (markers.has(oldestKey)) {
            const oldMarker = markers.get(oldestKey);
            scene.remove(oldMarker.group);
            markers.delete(oldestKey);
        }
    }
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    cleanupMarkers();

    markers.forEach((data) => {
        const beam = data.group.children[1];
        const baseOpacity = beam.material.opacity;
        beam.material.opacity = baseOpacity * (0.9 + 0.1 * Math.sin(Date.now() * 0.003));
    });

    renderer.render(scene, camera);
}

function onWindowResize() {
    const aspect = (window.innerWidth - 400) / window.innerHeight;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth - 400, window.innerHeight);
}

function onMouseMove(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const intersects = [];
    markers.forEach(markerData => {
        const intersectedObjects = raycaster.intersectObjects(markerData.group.children, true);
        if (intersectedObjects.length > 0) {
            intersects.push({ distance: intersectedObjects[0].distance, markerData });
        }
    });

    const tooltip = document.getElementById('tooltip');

    if (intersects.length > 0) {
        intersects.sort((a, b) => a.distance - b.distance);
        const closest = intersects[0].markerData;

        const data = pointData.get(closest.key);
        if (data) {
            tooltip.style.left = event.clientX + 15 + 'px';
            tooltip.style.top = event.clientY + 15 + 'px';

            tooltip.innerHTML = `
                <div class="tooltip-title ${data.suspicious ? 'suspicious' : ''}">
                    ${data.suspicious ? 'Suspicious Package' : 'Package'} at ${new Date(data.timestamp).toLocaleTimeString()}
                </div>
                <div class="tooltip-detail">IP: ${data.ip}</div>
                <div class="tooltip-detail">Location: ${data.latitude.toFixed(4)}, ${data.longitude.toFixed(4)}</div>
                <div class="tooltip-detail">Hits: ${closest.count}</div>
                <div class="tooltip-detail">Last update: ${new Date(closest.timestamp).toLocaleTimeString()}</div>
            `;
            tooltip.style.display = 'block';
        }
    } else {
        tooltip.style.display = 'none';
    }
}

init();

window.updateGlobeMarker = updateMarker;
document.querySelectorAll('input[name="preset"]').forEach(radio => {
    radio.addEventListener('change', function () {
        const presets = {
            normal: { points: 50, fade: 30 },
            dense: { points: 100, fade: 60 },
            sparse: { points: 25, fade: 15 }
        };

        const preset = presets[this.value];
        if (preset) {
            const pointLimitInput = document.getElementById('pointLimit');
            const fadeTimeInput = document.getElementById('fadeTime');

            pointLimitInput.value = preset.points;
            fadeTimeInput.value = preset.fade;

            pointLimit = preset.points;
            const newFadeTime = preset.fade;
            if (newFadeTime > fadeTimeSeconds) {
                restorePoints(newFadeTime);
            }
            fadeTimeSeconds = newFadeTime;
            cleanupMarkers();
        }
    });
});

let stats = {
    totalPackages: 0,
    suspiciousPackages: 0,
    locations: {},
    locationIPs: {},
    uniqueIps: new Set(),
    recentPackages: [],
    lastMinuteCheck: Date.now()
};

let processedPackages = new Set();
const statusDiv = document.getElementById('connection-status');
const updatesDiv = document.getElementById('updates');
let es = null;

function updateStatus(status, className) {
    statusDiv.textContent = status;
    statusDiv.className = `connection-status ${className}`;
}

function getPackageKey(data) {
    return `${data.ip}-${data.latitude}-${data.longitude}-${data.timestamp}`;
}

function updatePackagesPerMinute() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    stats.recentPackages = stats.recentPackages.filter(timestamp => timestamp > oneMinuteAgo);

    const rate = Math.round((stats.recentPackages.length / 60) * 10) / 10;
    document.getElementById('packages-per-minute').textContent = rate.toFixed(1);
}

setInterval(updatePackagesPerMinute, 10000);

function updateStats(data) {
    const now = Date.now();

    stats.totalPackages++;
    document.getElementById('total-packages').textContent = stats.totalPackages;

    if (data.suspicious) {
        stats.suspiciousPackages++;
        document.getElementById('suspicious-packages').textContent = stats.suspiciousPackages;
    }

    stats.uniqueIps.add(data.ip);
    document.getElementById('unique-ips').textContent = stats.uniqueIps.size;

    const location = `${data.latitude.toFixed(2)},${data.longitude.toFixed(2)}`;
    stats.locations[location] = (stats.locations[location] || 0) + 1;

    if (!stats.locationIPs[location]) {
        stats.locationIPs[location] = new Set();
    }
    stats.locationIPs[location].add(data.ip);

    const topLocation = Object.entries(stats.locations)
        .sort((a, b) => b[1] - a[1])[0];

    if (topLocation) {
        const [loc, count] = topLocation;
        const ips = stats.locationIPs[loc];
        const topIP = Array.from(ips).slice(-1)[0];
        document.getElementById('top-location').textContent = `${count} pkgs`;
        document.getElementById('top-location-details').textContent =
            `${loc} (${ips.size} IPs, latest: ${topIP})`;
    }

    stats.recentPackages.push(now);
    if (now - stats.lastMinuteCheck > 2000) {
        updatePackagesPerMinute();
        stats.lastMinuteCheck = now;
    }

    window.updateGlobeMarker(data.latitude, data.longitude, data.suspicious, data);
}

function renderPackage(data) {
    const packageKey = getPackageKey(data);

    if (processedPackages.has(packageKey)) {
        return;
    }
    processedPackages.add(packageKey);

    const entry = document.createElement('div');
    entry.className = `package ${data.suspicious ? 'suspicious' : ''}`;
    const suspiciousTag = data.suspicious ? '<span class="suspicious-tag">Suspicious</span>' : '';
    entry.innerHTML = `
        <p><strong>Package ${data.packege_id || 'N/A'} @ ${new Date().toLocaleTimeString()}</strong>${suspiciousTag}</p>
        <ul>
            <li>IP: ${data.ip}</li>
            <li>Location: ${data.latitude.toFixed(4)}, ${data.longitude.toFixed(4)}</li>
            <li>Received: ${new Date(data.timestamp).toLocaleString()}</li>
        </ul>
    `;
    updatesDiv.prepend(entry);
    updateStats(data);
}

async function connectSSE() {
    if (es) es.close();

    try {
        updateStatus('Fetching history...', 'reconnecting');
        const historyResponse = await fetch('http://localhost:8080/history');
        const historicalPackages = await historyResponse.json();

        console.log(`Processing ${historicalPackages.length} historical packages`);

        historicalPackages
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
            .forEach(data => {
                renderPackage(data);
            });

        updateStatus('Connecting live feed...', 'reconnecting');
        es = new EventSource('http://localhost:8080/stream');

        es.addEventListener('open', () => {
            console.log('SSE Connection established');
            updateStatus('Connected', 'connected');
        });

        es.addEventListener('package', (e) => {
            try {
                const data = JSON.parse(e.data);
                renderPackage(data);
            } catch (err) {
                console.error("Parse error:", err, "Data:", e.data);
            }
        });

        es.onerror = () => {
            updateStatus('Connection lost', 'disconnected');
            es.close();
        };

    } catch (error) {
        console.error('Connection error:', error);
        updateStatus('Connection failed', 'disconnected');
    }
}
const reconnectButton = document.createElement('button');
reconnectButton.innerText = 'Reconnect';
reconnectButton.style.cssText = `
    position: absolute;
    top: 10px;
    right: 10px;
    padding: 8px 16px;
    background-color: #007bff;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: bold;
`;
reconnectButton.addEventListener('click', () => {
    processedPackages.clear();
    connectSSE();
});
document.body.appendChild(reconnectButton);

connectSSE();

window.addEventListener('beforeunload', () => {
    if (es) es.close();
});
