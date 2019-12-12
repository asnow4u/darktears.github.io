/*!
 *
 * Copyright 2016 Google Inc. All rights reserved.
 * Copyright 2018 Intel Corporation. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

//var polyfill = new WebXRPolyfill();

const Direction = {
  Stopped: 0,
  Left: 1,
  Right: 2,
  Forward: 4,
  Backward: 8
}

const DragState = {
  Rotate: 0,
  Move: 1
}

class Demo {

  static get CAMERA_SETTINGS() {
    return {
      viewAngle: 45,
      near: 0.1,
      far: 10000
    };
  }

  static get VIVE_CONTROLLER_MODEL_URL() { return 'https://cdn.aframe.io/controllers/vive/'; }
  static get DAYDREAM_CONTROLLER_MODEL_URL() { return 'https://cdn.aframe.io/controllers/google/'; }

  constructor() {
    this._width;
    this._height;
    this._renderer;
    this._camera;
    this._aspect;
    this._settings;
    this._gltfObject;
    this._container = document.querySelector('#container');
    this._startMessage = document.querySelector('#start');
    this._touchControls = document.querySelector('#joystickControls');
    this._joystick = document.querySelector('#joystick');

    this._backgroundColor = new THREE.Color(0x000000);

    this.clearContainer();
    this.createRenderer();

    this._onResize = this._onResize.bind(this);
    this._render = this._render.bind(this);
    this._onResize();

    this.createCamera();
    this.createScene();

    this._addEventListeners();
    requestAnimationFrame(this._render);

    this._xrSession;
    this._xrReferenceSpace;
    this._magicWindowCanvas;
    this._activeControllers = 0;
    this._controllers = [];
    this._controllersMeshes = [];
    this._activeLasers = 0;
    this._lasers = [];
    this._cursors = [];
    this._activeCursors = 0;
    this._prevTime = performance.now();
    this._userPosition = new THREE.Vector3();
    this._velocity = new THREE.Vector3();
    this._movingDirection = Direction.Stopped;

    this._animationMixers = [];
    this._clock = new THREE.Clock();
  }

  _enableKeyboardMouse() {
    if (!this._hasPointerLock())
      return;
    this._controls = new THREE.PointerLockControls(this._camera);
    this._scene.add(this._controls.getObject());
    this._controls.getObject().position.y = 1;
    this._camera.lookAt(new THREE.Vector3(0, 1, -1));
    // Hook pointer lock state change events
    document.addEventListener('pointerlockchange', _ => { this._pointerLockChanged() }, false );
    document.addEventListener('mozpointerlockchange', _ => { this._pointerLockChanged() }, false );
    document.addEventListener('webkitpointerlockchange', _ => { this._pointerLockChanged() }, false );
    document.addEventListener('keydown', event => { this._onKeyDown(event) }, false );
    document.addEventListener('keyup', event => { this._onKeyUp(event) }, false );

    document.body.addEventListener( 'click', _ => {
      // Ask the browser to lock the pointer
      document.body.requestPointerLock = document.body.requestPointerLock ||
        document.body.mozRequestPointerLock ||
        document.body.webkitRequestPointerLock;
      document.body.requestPointerLock();
    }, false);
  }

  _onKeyDown(event) {
    switch ( event.keyCode ) {
      case 38: // up
      case 87: // w
        this._movingDirection |= Direction.Forward;
        break;
      case 37: // left
      case 65: // a
        this._movingDirection |= Direction.Left;
        break;
      case 40: // down
      case 83: // s
        this._movingDirection |= Direction.Backward;
        break;
      case 39: // right
      case 68: // d
        this._movingDirection |= Direction.Right;
        break;
    }
  }

  _onKeyUp(event) {
    switch( event.keyCode ) {
      case 38: // up
      case 87: // w
        this._movingDirection &= ~Direction.Forward;
        break;
      case 37: // left
      case 65: // a
        this._movingDirection &= ~Direction.Left;
        break;
      case 40: // down
      case 83: // s
        this._movingDirection &= ~Direction.Backward;
        break;
      case 39: // right
      case 68: // d
        this._movingDirection &= ~Direction.Right;
        break;
    }
  }

  _hideStartMessage() {
    this._startMessage.style.display = 'none';
  }

  _showStartMessage() {
    this._startMessage.style.display = 'flex';
  }

  _hideTouchControls() {
    this._touchControls.style.display = 'none';
    if (window.PointerEvent) {
      joystick.removeEventListener('pointerdown', this._handlePointerDown);
      joystick.removeEventListener('pointermove', this._handlePointerMove);
      joystick.removeEventListener('pointerup', this._handleTouchEnd);
    } else {
      joystick.removeEventListener('touchstart', this._handleTouchStart);
      joystick.removeEventListener('touchmove', this._handleTouchMove);
      joystick.removeEventListener('touchend', this._handleTouchEnd);
    }
  }

  _showTouchControls() {
    this._touchControls.style.display = 'inline';
    this._handleTouchEnd = this._handleTouchEnd.bind(this);
    if (window.PointerEvent) {
      this._handlePointerMove = this._handlePointerMove.bind(this);
      this._handlePointerDown = this._handlePointerDown.bind(this);
      joystick.addEventListener('pointerdown', this._handlePointerDown);
      joystick.addEventListener('pointermove', this._handlePointerMove);
      joystick.addEventListener('pointerup', this._handleTouchEnd);
    } else {
      this._handleTouchMove = this._handleTouchMove.bind(this);
      this._handleTouchStart = this._handleTouchStart.bind(this);
      joystick.addEventListener('touchstart', this._handleTouchStart);
      joystick.addEventListener('touchmove', this._handleTouchMove);
      joystick.addEventListener('touchend', this._handleTouchEnd);
    }
  }

  _handlePointerDown(ev) {
    this._joystickOriginX = ev.x;
    this._joystickOriginY = ev.y;
    this._currentPointerId = ev.pointerId;
  }

  _handleTouchStart(ev) {
    let touch	= event.changedTouches[0];
    this._currentTouchId	= touch.identifier;
    this._joystickOriginX = touch.pageX;
    this._joystickOriginY = touch.pageY;
    ev.preventDefault();
  }

  _handlePointerMove(ev) {
    if(this._currentPointerId === null)
      return;
    let deltaX = ev.x - this._joystickOriginX;
    let deltaY = ev.y - this._joystickOriginY;
    this._computeDirection(deltaX, deltaY);
  }

  _handleTouchMove(ev) {
    if( this._currentTouchId === null)
      return;
    let touchList	= ev.changedTouches;
    for(let i = 0; i < touchList.length; i++) {
        if(touchList[i].identifier == this._currentTouchId) {
          var touch	= touchList[i];
          let deltaX = touch.pageX - this._joystickOriginX;
          let deltaY = touch.pageY - this._joystickOriginY;
          this._computeDirection(deltaX, deltaY);
          ev.preventDefault();
        }
    }
  }

  _computeDirection(deltaX, deltaY) {
    if ((deltaX <= 70 && deltaX >= -70) && (deltaY <= 70 && deltaY >= -70))
      joystick.style.transform = 'translate(' + deltaX + 'px,' + deltaY + 'px)';
    let rotation = Math.atan2(deltaY, deltaX);
    let angle45Degree = Math.PI / 4;
    if (rotation > angle45Degree && rotation < angle45Degree * 3)
      this._movingDirection = Direction.Backward;
    else if (rotation < -angle45Degree && rotation > -angle45Degree * 3)
      this._movingDirection = Direction.Forward;
    else if (rotation >= 0 && rotation <= angle45Degree)
      this._movingDirection = Direction.Right;
    else if (rotation <= -angle45Degree * 3 || rotation >= angle45Degree * 3)
      this._movingDirection = Direction.Left;
  }

  _handleTouchEnd() {
    this._joystickOriginX = 0;
    this._joystickOriginY = 0;
    this._currentTouchId	= null;
    this._currentPointerId = null;
    this._movingDirection = Direction.Stopped;
    this._joystick.style.transform = 'translate(0px, 0px)';
  }

  _pointerLockChanged() {
    if (document.pointerLockElement === document.body ||
        document.mozPointerLockElement === document.body ||
        document.webkitPointerLockElement === document.body) {
      this._controls.enabled = true;
      this._hideStartMessage();
    } else {
      this._showStartMessage();
      this._controls.enabled = false;
    }
  }

  _checkMagicWindowSupport() {
    this._magicWindowCanvas = document.createElement("canvas");
    let magicWindowContext = this._magicWindowCanvas.getContext('xrpresent');
    // Check to see if the UA can support a non-immersive sessions with the given output context.
    return navigator.xr.supportsSession('inline')
        .then(() => {
          this._activateMagicWindow(magicWindowContext);
          this._magicWindowCanvas.width = this._width;
          this._magicWindowCanvas.height = this._height;
          this._container.appendChild(this._magicWindowCanvas);
        })
        .catch((reason) => { console.log("Inline content is not supported: " + reason); });
  }

  _checkForXR() {
    if (navigator.xr === undefined) {
      this._enableKeyboardMouse();
      console.log("WebXR Device API is not supported in this browser");
      return;
    }
    this._hideStartMessage();
    this._loadViveMeshes();
    this._loadDaydreamMeshes();
    navigator.xr.supportsSession('immersive-vr').then(() => {
      this._createPresentationButton();
      //this._checkMagicWindowSupport();
    }).catch((err) => {
      console.log("VR Immersive not supported: " + err);
    });
  }

  _loadViveMeshes() {
    let mtlLoader = new THREE.MTLLoader();
    mtlLoader.crossOrigin = '';
    mtlLoader.setPath(Demo.VIVE_CONTROLLER_MODEL_URL);
    mtlLoader.load('vr_controller_vive.mtl', (materials) => {
      materials.preload();
      let objLoader = new THREE.OBJLoader();
      objLoader.setMaterials( materials );
      objLoader.setPath(Demo.VIVE_CONTROLLER_MODEL_URL);
      objLoader.load('vr_controller_vive.obj', (object) => {
        this._controllersMeshes['vive'] = object;
      });
    });
  }

  _loadDaydreamMeshes() {
    let mtlLoader = new THREE.MTLLoader();
    mtlLoader.crossOrigin = '';
    mtlLoader.setPath(Demo.DAYDREAM_CONTROLLER_MODEL_URL);
    mtlLoader.load('vr_controller_daydream.mtl', (materials) => {
      materials.preload();

      var objLoader = new THREE.OBJLoader();
      objLoader.setMaterials( materials );
      objLoader.setPath(Demo.DAYDREAM_CONTROLLER_MODEL_URL);
      objLoader.load('vr_controller_daydream.obj', (object) => {
        this._controllersMeshes['daydream'] = object;
      });
    });
  }

  _onResize () {
    this._width = window.innerWidth;
    this._height = window.innerHeight;
    this._aspect = this._width / this._height;

    this._renderer.setSize(this._width, this._height);

    if (this._magicWindowCanvas) {
      this._magicWindowCanvas.width = this._width;
      this._magicWindowCanvas.height = this._height;
    }

    if (!this._camera) {
      return;
    }

    this._camera.aspect = this._aspect;
    this._camera.updateProjectionMatrix();
  }

  _addEventListeners() {
    window.addEventListener('resize', this._onResize);
  }

  clearContainer() {
    this._container.innerHTML = '';
  }

  createRenderer() {
    this._renderer = new THREE.WebGLRenderer({ antialias : true });
    this._renderer.shadowMap.enabled = true;
    this._renderer.gammaInput = true;
    this._renderer.gammaOutput = true;
    this._container.appendChild(this._renderer.domElement);
  }

  createCamera() {
    this._settings = Demo.CAMERA_SETTINGS;
    this._camera = new THREE.PerspectiveCamera(
        this._settings.viewAngle,
        this._aspect,
        this._settings.near,
        this._settings.far
    );
  }

  createScene() {
    this._scene = new THREE.Scene();

    const urls = ['px.png', 'nx.png', 'py.png', 'ny.png', 'pz.png', 'nz.png'];
    let cubeMap = new THREE.CubeTextureLoader()
      .setPath('./textures/cube/basic-light/')
      .load(urls, _ => {
        cubeMap.encoding = THREE.GammaEncoding;
        var pmremGenerator = new THREE.PMREMGenerator(cubeMap);
        pmremGenerator.update(this._renderer);
        var pmremCubeUVPacker = new THREE.PMREMCubeUVPacker(pmremGenerator.cubeLods);
        pmremCubeUVPacker.update(this._renderer);
        this._cuberRenderTarget = pmremCubeUVPacker.CubeUVRenderTarget;
        pmremGenerator.dispose();
        pmremCubeUVPacker.dispose();
        this.createMeshes();
      });
  }

  createMeshes() {
    // Heart model
    let loader = new THREE.GLTFLoader();
    loader.load('models/gltf/heart/scene.gltf', (object) => {
       this._addGLTFModel(object);
       this._checkForXR();
    }, function (xhr) {
      console.log((xhr.loaded / xhr.total * 100 ) + '% of GLTF model loaded.' );
    }, function (error) {
      console.log( 'An error happened while loading the GLTF model : ' + error);
    });

    let wallMaterial = [
      new THREE.MeshBasicMaterial({
          wireframe: true,
          side: THREE.DoubleSide
      })
    ];

    let roofMaterial = [
      new THREE.MeshBasicMaterial({
          wireframe: true,
          side: THREE.DoubleSide
      })
    ];

    let floorMaterial = [
      new THREE.MeshBasicMaterial({
          color: 0x999999
      })
    ];

    //Build the walls.
    const roomGeometry = new THREE.PlaneGeometry(10, 3, 10, 10);
    let wall = new THREE.Mesh(roomGeometry, wallMaterial);
    wall.position.z = 3;
    wall.position.y = 1;
    this._scene.add(wall);

    wall = new THREE.Mesh(roomGeometry, wallMaterial);
    wall.position.z = -2;
    wall.position.y = 1;
    wall.position.x = 5;
    wall.rotation.y = -Math.PI / 2;
    this._scene.add(wall);

    wall = new THREE.Mesh(roomGeometry, wallMaterial);
    wall.position.z = -7;
    wall.position.y = 1;
    this._scene.add(wall);

    wall = new THREE.Mesh(roomGeometry, wallMaterial);
    wall.position.z = -2;
    wall.position.x = -5;
    wall.position.y = 1;
    wall.rotation.y = -Math.PI / 2;
    this._scene.add(wall);

    const squareGeometry = new THREE.PlaneGeometry(10, 10, 20, 20);
    this._floor = new THREE.Mesh(squareGeometry, floorMaterial);
    this._floor.position.z = -2;
    this._floor.position.y = -0.5;
    this._floor.rotation.x = -Math.PI / 2;
    this._floor.name = "floor";
    this._floor.receiveShadow = true;
    this._scene.add(this._floor);

    let grid = new THREE.GridHelper(20, 20, this._backgroundColor, this._backgroundColor);
    grid.material.opacity = 0.2;
    grid.material.transparent = true;
    grid.name = "grid";
    this._scene.add(grid);

    let roof = new THREE.Mesh(squareGeometry, roofMaterial);
    roof.position.z = -2;
    roof.position.y = 2.5;
    roof.rotation.x = -Math.PI / 2;
    this._scene.add(roof);

    const lightColor = 0x7F7F7F;
    const lightIntensity = 3;

    let light = new THREE.DirectionalLight(lightColor, lightIntensity);
    light.position.set( 0, 2, 1.5);
    light.lookAt(0, 0.8, -1.6)
    this._scene.add(light);

    light = new THREE.DirectionalLight(lightColor, lightIntensity);
    light.position.set(0, -1, 2);
    light.lookAt(0, 0.8, -1.6)
    this._scene.add(light);

    light = new THREE.DirectionalLight(lightColor, lightIntensity);
    light.position.set(-2, 2, 0);
    light.lookAt(0, 0.8, -1.6)
    this._scene.add(light);

    light = new THREE.DirectionalLight(lightColor, lightIntensity);
    light.position.set(2, 2, 0);
    light.lookAt(0, 0.8, -1.6)
    this._scene.add(light);

    // Right light.
    light = new THREE.DirectionalLight(lightColor, lightIntensity);
    light.position.set(2, 0.8, 0);
    light.lookAt(0, 1, -1.6)
    this._scene.add(light);

    // Left light.
    light = new THREE.DirectionalLight(lightColor, lightIntensity);
    light.position.set(-2, 0.8, 0);
    light.lookAt(0, 0.8, -1.6)
    this._scene.add(light);

    // Back light.
    light = new THREE.DirectionalLight(lightColor, lightIntensity);
    light.position.set(0, 0.8, -4);
    light.lookAt(0, 0.8, -1.6)
    this._scene.add(light);
  }

  _addGLTFModel(gltf) {
    this._gltfObject = gltf.scene;
    this._gltfObject.position.z = -1.3;
    this._gltfObject.position.y = 0.8;
    this._gltfObject.rotation.y = - Math.PI / 1.5;
    this._gltfObject.rotation.x = Math.PI / 10;
    this._gltfObject.scale.copy(new THREE.Vector3(0.1, 0.1, 0.1));
    this._gltfObject.name = 'heart';

    gltf.animations.forEach((clip) => {
        let mixer = new THREE.AnimationMixer(this._gltfObject);
        this._animationMixers.push(mixer);
        mixer.clipAction(clip).play();
    });
    this._gltfObject.traverse(child => {
      if (child.isMesh) {
        child.material.metalness = 1;
        child.material.roughness = 0.3;
        child.material.receiveShadow = true;
        child.material.envMap = this._cuberRenderTarget.texture;
      }
    });

    this._scene.add(this._gltfObject);
  }

  _createPresentationButton() {
      this._button = document.createElement('button');
      this._button.classList.add('vr-toggle');
      this._button.textContent = 'Switch to XR';
      this._button.addEventListener('click', _ => {
        this._toggleVR();
      });
      document.body.appendChild(this._button);
  }

  async _toggleVR() {
    if (!this._renderer.domElement.hidden && this._xrSession) {
      return this._deactivateVR();
    }

    if (this._renderer.domElement.hidden && this._xrSession) {
      await this._xrSession.end();
      this._xrSession = null;
      this._xrReferenceSpace = null;
    }

    return this._activateVR();
  }

  async _deactivateVR() {
    if (!this._xrSession) {
      return;
    }

    await this._xrSession.end();
  }

  async _onSessionEnded() {
    this._xrSession = null;
    this._xrReferenceSpace = null;
    this._renderer.context.bindFramebuffer(this._renderer.context.FRAMEBUFFER, null);
    this._activeControllers = 0;
    for (let controller of this._controllers) {
      this._scene.remove(controller);
    }
    this._controllers = [];
    this._activeLasers = 0;
    for (let laser of this._lasers) {
      this._scene.remove(laser);
    }
    this._lasers = [];
    this._activeCursors = 0;
    for (let cursor of this._cursors) {
      this._scene.remove(cursor);
    }
    this._cursors = [];
    requestAnimationFrame(this._render);
    if (this._magicWindowCanvas)
      this._activateMagicWindow(this._magicWindowCanvas.getContext('xrpresent'));
  }

  async _activateMagicWindow(ctx) {
    if (!this._xrDevice) {
      return;
    }

    try {
      this._xrSession = await navigator.xr.requestSession('inline');

      await this._xrSession.updateRenderState({ outputContext: ctx });

      this._xrSession.depthNear = Demo.CAMERA_SETTINGS.near;
      this._xrSession.depthFar = Demo.CAMERA_SETTINGS.far;

      // Reference frame for VR: stage vs headModel.
      this._xrReferenceSpace = await this._xrSession.requestReferenceSpace({ type:'stationary', subtype:'eye-level' });

      // Create the WebGL layer.
      await this._renderer.context.makeXRCompatible();
      this._renderer.domElement.hidden = true;
      this._magicWindowCanvas.hidden = false;
      let layer = new XRWebGLLayer(this._xrSession, this._renderer.context);
      this._xrSession.updateRenderState({ baseLayer: layer });
      this._userPosition.set(0, 0, 0);

      this._showTouchControls();

      // Enter the rendering loop.
      this._xrSession.requestAnimationFrame(this._render);

    } catch (error) {
      console.log("Error while requesting magic window session : " + error);
    };
  }

  async _activateVR() {
    try {
      // ‘Immersive’ means rendering into the HMD.
      this._xrSession = await navigator.xr.requestSession('immersive-vr');
      this._xrSession.addEventListener('end', _ => { this._onSessionEnded(); });

      this._heartDragged = {dragState : DragState.Rotate};

      this._xrSession.depthNear = Demo.CAMERA_SETTINGS.near;
      this._xrSession.depthFar = Demo.CAMERA_SETTINGS.far;

      // Reference frame for VR: stage vs headModel.
      this._xrReferenceSpace = await this._xrSession.requestReferenceSpace({ type:'stationary', subtype:'floor-level' });
      this._xrSession.addEventListener('select', (ev) => {
          this._handleSelect(ev.inputSource, ev.frame, this._xrReferenceSpace);
      });
      this._xrSession.addEventListener('selectstart', (ev) => {
          this._handleSelectStart(ev.inputSource, ev.frame, this._xrReferenceSpace);
      });

      // Create the WebGL layer.
      await this._renderer.context.makeXRCompatible();
      this._renderer.domElement.hidden = false;
      if (this._magicWindowCanvas) {
        this._magicWindowCanvas.hidden = true;
        this._hideTouchControls();
      }
      let layer = new XRWebGLLayer(this._xrSession, this._renderer.context);
      this._xrSession.updateRenderState({ baseLayer: layer });

      // Enter the rendering loop.
      this._xrSession.requestAnimationFrame(this._render);

    } catch (error) {
      console.log("Error while requesting the immersive session : " + error);
    };
  }

  _updatePosition() {
    let time = performance.now();
    let delta = (time - this._prevTime) / 1000;

    // Decrease the velocity.
    this._velocity.x -= this._velocity.x * 10.0 * delta;
		this._velocity.z -= this._velocity.z * 10.0 * delta;

    let controls_yaw = this._controls.getObject();

    let movingDistance = 100.0 * delta;
    if ((this._movingDirection & Direction.Forward) === Direction.Forward)
      this._velocity.z -= movingDistance;
    if ((this._movingDirection & Direction.Backward) === Direction.Backward)
      this._velocity.z += movingDistance;
    if ((this._movingDirection & Direction.Left) === Direction.Left)
      this._velocity.x -= movingDistance;
    if ((this._movingDirection & Direction.Right) === Direction.Right)
      this._velocity.x += movingDistance;

    controls_yaw.translateX(this._velocity.x * delta);
    controls_yaw.translateZ(this._velocity.z * delta);

    // Check bounds so we don't walk through the walls.
    if (controls_yaw.position.z > 2)
      controls_yaw.position.z = 2;
    if (controls_yaw.position.z < -6)
      controls_yaw.position.z = -6;

    if (controls_yaw.position.x > 4)
      controls_yaw.position.x = 4;
    if (controls_yaw.position.x < -4)
      controls_yaw.position.x = -4;

    this._prevTime = time;
  }

  _render(timestamp, xrFrame) {
    // Update the mixers for the 3D models animations.
    if (this._animationMixers.length > 0) {
      const delta = this._clock.getDelta();
      for (let i = 0; i < this._animationMixers.length; i ++) {
        this._animationMixers[i].update(delta);
      }
    }

    if (!this._xrSession) {
      // Ensure that we switch everything back to auto for non-VR mode.
      this._onResize();
      this._renderer.setViewport(0, 0, this._width, this._height);
      this._renderer.autoClear = true;
      this._scene.matrixAutoUpdate = true;
      if (this._controls && this._controls.enabled) {
        this._updatePosition();
      }
      this._renderer.render(this._scene, this._camera);
      return requestAnimationFrame(this._render);
    }
    if (!xrFrame)
      return;

    // Disable autoupdating because these values will be coming from the
    // frameData data directly.
    this._scene.matrixAutoUpdate = false;

    // Make sure not to clear the renderer automatically, because we will need
    // to render it ourselves twice, once for each eye.
    this._renderer.autoClear = false;

    // Clear the canvas manually.
    this._renderer.clear();

    // Get pose data.
    let pose = xrFrame.getViewerPose(this._xrReferenceSpace);
    if (pose) {
      let xrLayer = this._xrSession.renderState.baseLayer;

      this._renderer.setSize(xrLayer.framebufferWidth, xrLayer.framebufferHeight, false);

      this._renderer.context.bindFramebuffer(this._renderer.context.FRAMEBUFFER, xrLayer.framebuffer);

      this._updateInput(xrFrame);

      for (let xrView of pose.views) {
        let viewport = xrLayer.getViewport(xrView);
        this._renderEye(
          xrView,
          viewport);
      }
    }
    // Use the VR display's in-built rAF (which can be a diff refresh rate to
    // the default browser one).
    this._xrSession.requestAnimationFrame(this._render);
  }

  _renderEye(xrView, viewport) {
    // Set the left or right eye half.
    this._renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);

    let viewMatrix = new THREE.Matrix4();
    viewMatrix.fromArray(xrView.transform.inverse.matrix);

    if (this._magicWindowCanvas && this._magicWindowCanvas.hidden === false) {
      // This will adjust the position of the user depending if
      // the keypad was pressed.
      this._updateMagicWindowPosition(viewMatrix);
    }

    // Update the scene and camera matrices.
    this._camera.projectionMatrix.fromArray(xrView.projectionMatrix);
    this._camera.matrixWorldInverse.copy(viewMatrix);
    this._scene.matrix.copy(viewMatrix);

    // Tell the scene to update (otherwise it will ignore the change of matrix).
    this._scene.updateMatrixWorld(true);
    this._renderer.render(this._scene, this._camera);
    // Ensure that left eye calcs aren't going to interfere.
    this._renderer.clearDepth();
  }

  _updateMagicWindowPosition(viewMatrix) {
    let rotation = new THREE.Quaternion();
    viewMatrix.decompose(new THREE.Vector3(), rotation, new THREE.Vector3());
    let time = performance.now();
    let delta = (time - this._prevTime) / 1000;

    // Decrease the velocity.
    this._velocity.x -= this._velocity.x * 10.0 * delta;
    this._velocity.z -= this._velocity.z * 10.0 * delta;

    let invertedRotation = rotation.inverse();
    // Extract the yaw rotation only because x and z axis rotations are
    // not needed to translate the user position. The following code
    // renormalize on the Y axis.
    let norm = Math.sqrt(invertedRotation.w * invertedRotation.w + invertedRotation.y * invertedRotation.y);
    let invertedYawRotation = new THREE.Quaternion(0, invertedRotation.y / norm, 0, invertedRotation.w / norm);

    let delta_z = 0;
    let delta_x = 0;
    let movingDistance = 70.0 * delta * delta;
    if ((this._movingDirection & Direction.Forward) === Direction.Forward)
      delta_z = movingDistance;
    if ((this._movingDirection & Direction.Backward) === Direction.Backward)
      delta_z = -movingDistance;
    if ((this._movingDirection & Direction.Left) === Direction.Left)
      delta_x = movingDistance;
    if ((this._movingDirection & Direction.Right) === Direction.Right)
      delta_x = -movingDistance;

    // Move back to view coordinates.
    let deltaPosition = new THREE.Vector3(delta_x, 0, delta_z);
    // This will make sure that the translation from the keypad is always
    // done in the right direction regardless the rotation.
    deltaPosition.applyQuaternion(invertedYawRotation);

    this._userPosition.add(deltaPosition);

    // Check bounds so we don't walk through the walls.
    if (this._userPosition.z > 6)
      this._userPosition.z = 6;
    if (this._userPosition.z < -2)
      this._userPosition.z = -2;
    if (this._userPosition.x > 4)
      this._userPosition.x = 4;
    if (this._userPosition.x < -4)
      this._userPosition.x = -4;

    this._prevTime = time;
  }

  _handleSelect(inputSource, frame, referenceSpace) {
    let rayPose = frame.getPose(inputSource.targetRaySpace, referenceSpace);

    if (!rayPose)
      return;

    if(this._heartDragged) {
      if (this._heartDragged.dragState === DragState.Rotate) {
        this._heartDragged = { dragState : DragState.Move };
      } else if (this._heartDragged.dragState == DragState.Move) {
        this._heartDragged = { dragState : DragState.Rotate };
      }
    }

    return;
  }

  _handleSelectStart(inputSource, frame, referenceSpace) {
    let gripPose = frame.getPose(inputSource.gripSpace, referenceSpace);

    if (!gripPose)
      return;

    if (this._heartDragged.dragState === DragState.NotDragging)
      return;

    let pointerMatrix = new THREE.Matrix4();
    pointerMatrix.fromArray(gripPose.transform.matrix);
    let raycaster = new THREE.Raycaster();
    this._setupControllerRaycast(raycaster, pointerMatrix);
    let intersects = raycaster.intersectObject(this._gltfObject, true);
    for (let intersect of intersects) {
      let gripMatrix = new THREE.Matrix4();
      let gripRotation = new THREE.Quaternion();
      gripMatrix.fromArray(gripPose.transform.matrix);
      gripMatrix.decompose(new THREE.Vector3(), gripRotation, new THREE.Vector3());
      this._heartDragged = {dragState : this._heartDragged.dragState, dragStartInvertedRotation : gripRotation.inverse(), heartStartRotation : this._gltfObject.quaternion.clone()};
      break;
    }
  }

  _setupControllerRaycast(raycaster, rayMatrix) {
    // We should probably use XRay here but the
    // origin and direction doesn't really work here.
    let raycasterOrigin = new THREE.Vector3();
    let raycasterDestination = new THREE.Vector3(0, 0, -1);
    let rayMatrixWorld = new THREE.Matrix4();
    rayMatrixWorld.multiplyMatrices(this._scene.matrixWorld, rayMatrix);
    raycasterOrigin.setFromMatrixPosition(rayMatrixWorld);
    raycaster.set(raycasterOrigin, raycasterDestination.transformDirection(rayMatrixWorld).normalize());
  }

  _updateInput(xrFrame) {
    let inputSources = this._xrSession.getInputSources();
    let intersected = false;
    for (let inputSource of inputSources) {
      let gripPose = xrFrame.getPose(inputSource.gripSpace, this._xrReferenceSpace);
      if (gripPose)
        this._drawController(gripPose.transform.matrix);


      let rayPose = xrFrame.getPose(inputSource.targetRaySpace, this._xrReferenceSpace);
      if (rayPose) {
        let color = this._getRandomColor();
        let cursor = null;

        if (this._activeCursors < this._cursors.length) {
          cursor = this._cursors[this._activeCursors];
        } else {
          let geometry = new THREE.CircleGeometry(0.05, 30);
          let material = new THREE.MeshBasicMaterial(
            {color: color, transparent: true, opacity : 0.5, side: THREE.DoubleSide});
          cursor = new THREE.Mesh(geometry, material);
          cursor.name = 'cursor';
          this._cursors.push(cursor);
          this._scene.add(cursor);
        }
        this._activeCursors = this._activeCursors + 1;

        let laserLength = 0;
        let pointerMatrix = new THREE.Matrix4();
        pointerMatrix.fromArray(rayPose.transform.matrix);
        let raycaster = new THREE.Raycaster();
        this._setupControllerRaycast(raycaster, pointerMatrix);
        let intersects = raycaster.intersectObjects(this._scene.children, true);

        for (let intersect of intersects) {
          if (intersect.object.name === 'laser' || intersect.object.name === 'cursor' || intersect.object.name === 'body' || intersect.object.name === 'grid')
            continue;

          laserLength = -intersect.distance + 0.1;
          let laser = this._getActiveLaser(color);
          if (intersect.object.name === 'node_id30')
            intersected = true;
          // Tracked pointer means it's a controller (not originating from the
          // head), we can draw a laser.
          if (inputSource.targetRayMode == 'tracked-pointer')
            this._drawStraightLaser(laser, laserLength, pointerMatrix, cursor);
          pointerMatrix.multiply(new THREE.Matrix4().makeTranslation(0, 0, laserLength));
          let position = new THREE.Vector3();
          pointerMatrix.decompose(position, new THREE.Quaternion(), new THREE.Vector3());
          cursor.position.copy(position);
          // This will make sure the cursor is parrallel to the intersect
          // object, it feels nice to me.
          cursor.rotation.set(intersect.object.rotation.x, intersect.object.rotation.y, intersect.object.rotation.z);
          break;
        }
      }
    }

    this._activeControllers = 0;
    this._activeLasers = 0;
    this._activeCursors = 0;

    if (intersected) {
      this._gltfObject.traverse( function ( child ) {
        if ( child.material ) {
          child.material.transparent = true;
          child.material.opacity = 0.6;
        }
      });
    } else {
      this._gltfObject.traverse( function ( child ) {
        if ( child.material ) {
          child.material.transparent = false;
          child.material.opacity = 1;
        }
      });
    }
  }

  _getActiveLaser(color) {
    let laser = null;
    if (this._activeLasers < this._lasers.length) {
      laser = this._lasers[this._activeLasers];
    } else {
      var material = new THREE.MeshBasicMaterial({color: color});
      let geometry = new THREE.BufferGeometry();
      laser = new THREE.Line(geometry, material);
      laser.name = 'laser';
      laser.frustumCulled = false;
      this._lasers.push(laser);
      this._scene.add(laser);
    }
    this._activeLasers = this._activeLasers + 1;
    return laser;
  }

  _drawController(gripMatrix) {
    let controller = null;
    if (this._activeControllers < this._controllers.length) {
      controller = this._controllers[this._activeControllers];
    } else {
      controller = this._controllersMeshes['daydream'].clone();
      this._controllers.push(controller);
      this._scene.add(controller);
    }
    this._activeControllers = this._activeControllers + 1;
    controller.visible = true;
    controller.matrixAutoUpdate = false;
    let grip = new THREE.Matrix4();
    grip.fromArray(gripMatrix);
    controller.matrix.copy(grip);
    controller.updateMatrixWorld(true);
    if(this._heartDragged.dragStartInvertedRotation) {
        let gripRotation = new THREE.Quaternion();
        grip.decompose(new THREE.Vector3(), gripRotation, new THREE.Vector3());
        gripRotation.multiply(this._heartDragged.dragStartInvertedRotation);
        if (this._heartDragged.dragState === DragState.Rotate) {
          // We only care of the rotation around the Y axis to rotate the model.
          let norm = Math.sqrt(gripRotation.w * gripRotation.w + gripRotation.y * gripRotation.y);
          let diffYRotation = new THREE.Quaternion(0, gripRotation.y / norm, 0, gripRotation.w / norm);
          let finalRotation = this._heartDragged.heartStartRotation.clone();
          finalRotation.multiply(diffYRotation.inverse());
          this._gltfObject.setRotationFromQuaternion(finalRotation);
        }

        if (this._heartDragged.dragState === DragState.Move) {
          let norm2 = Math.sqrt(gripRotation.w * gripRotation.w + gripRotation.x * gripRotation.x);
          let diffXRotation = new THREE.Quaternion(gripRotation.x / norm2, 0, 0, gripRotation.w / norm2);
          var eulerRotation = new THREE.Euler();
          eulerRotation.setFromQuaternion(diffXRotation);
          // Let's cap the movements from only -90 to 90.
          if (eulerRotation.x > Math.PI / 2 || eulerRotation.x < -Math.PI / 2)
            return;
          let delta = eulerRotation.x / (Math.PI / 2);
          let newZposition = this._gltfObject.position.z;
          // Make the move a bit smoother.
          newZposition += delta / 4;
          // Let's keep it in bound so it doesn't disappear.
          newZposition = Math.max(-6, Math.min(newZposition, 0));
          this._gltfObject.position.z = newZposition;
        }
    }
  }

  _drawStraightLaser(laser, length, pointerMatrix, cursor) {
    if (!laser)
      return;
    // It's a simple straight laser, we need 2 points (each of them have 3 coordinates).
    let vertices = new Float32Array(2 * 3);
    // Z coordinate for the second point.
    vertices[5] = length;
    laser.geometry.addAttribute('position', new THREE.BufferAttribute(vertices, 3));
    laser.geometry.attributes.position.array = vertices
    laser.geometry.verticesNeedUpdate = true;
    laser.visible = true;
    laser.matrixAutoUpdate = false;
    laser.matrix.copy(pointerMatrix);
    laser.updateMatrixWorld(true);

    let geometry = new THREE.CircleGeometry(0.05, 30);
    cursor.geometry.dispose();
    cursor.geometry = geometry;
  }

  _getRandomColor() {
    let letters = '0123456789ABCDEF';
    let color = '#';
    for (var i = 0; i < 6; i++) {
      color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
  }

  _hasPointerLock() {
    let havePointerLock = 'pointerLockElement' in document || 'mozPointerLockElement' in document || 'webkitPointerLockElement' in document;
    return havePointerLock;
  }
}

new Demo();
