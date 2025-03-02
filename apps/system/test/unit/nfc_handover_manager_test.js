'use strict';

/* globals MocksHelper, MockBluetooth, MockNavigatorSettings,
           NDEF, NfcConnectSystemDialog, MockBluetoothTransfer,
           MockL10n, NfcManager, NfcHandoverManager, NDEFUtils,
           MockMozNfc, NfcUtils, MockNavigatormozSetMessageHandler */

require('/shared/test/unit/mocks/mock_navigator_moz_set_message_handler.js');
require('/shared/test/unit/mocks/mock_settings_listener.js');
require('/shared/test/unit/mocks/mock_moz_ndefrecord.js');
require('/shared/test/unit/mocks/mock_moz_nfc.js');
require('/shared/test/unit/mocks/mock_l10n.js');
require('/shared/js/nfc_utils.js');
require('/shared/test/unit/mocks/mock_notification_helper.js');
requireApp('system/test/unit/mock_settingslistener_installer.js');
requireApp('system/test/unit/mock_system_nfc_connect_dialog.js');
requireApp('system/shared/test/unit/mocks/mock_event_target.js');
requireApp('system/shared/test/unit/mocks/mock_dom_request.js');
requireApp('system/test/unit/mock_bluetooth_transfer.js');
requireApp('system/test/unit/mock_bluetooth.js');
requireApp('system/test/unit/mock_activity.js');
requireApp('system/js/nfc_manager_utils.js');

var mocksForNfcUtils = new MocksHelper([
  'MozActivity',
  'BluetoothTransfer',
  'MozNDEFRecord',
  'NfcConnectSystemDialog',
  'NotificationHelper'
]).init();

suite('Nfc Handover Manager Functions', function() {

  var realMozNfc;
  var realMozSettings;
  var realMozBluetooth;
  var realMozSetMessageHandler;
  var realL10n;
  var spyDefaultAdapter;

  mocksForNfcUtils.attachTestHelpers();

  suiteSetup(function(done) {
    realMozNfc = navigator.mozNfc;
    realMozSettings = navigator.mozSettings;
    realMozBluetooth = navigator.mozBluetooth;
    realMozSetMessageHandler = navigator.mozSetMessageHandler;
    realL10n = navigator.mozL10n;

    navigator.mozNfc = MockMozNfc;
    navigator.mozSettings = MockNavigatorSettings;
    navigator.mozBluetooth = MockBluetooth;
    navigator.mozSetMessageHandler = MockNavigatormozSetMessageHandler;
    navigator.mozL10n = MockL10n;

    MockNavigatormozSetMessageHandler.mSetup();

    requireApp('system/js/ndef_utils.js');
    requireApp('system/js/nfc_manager.js');
    requireApp('system/js/nfc_handover_manager.js', function() {
      NfcHandoverManager.init();
      done();
    });
  });

  suiteTeardown(function() {
    MockNavigatormozSetMessageHandler.mTeardown();
    navigator.mozNfc = realMozNfc;
    navigator.mozSettings = realMozSettings;
    navigator.mozBluetooth = realMozBluetooth;
    navigator.mozSetMessageHandler = realMozSetMessageHandler;
    navigator.mozL10n = realL10n;
  });

  setup(function() {
    spyDefaultAdapter = this.sinon.spy(MockBluetooth, 'getDefaultAdapter');
  });

  teardown(function() {
    spyDefaultAdapter.restore();
  });

  var invokeBluetoothGetDefaultAdapter = function() {
    var adapterRequest = spyDefaultAdapter.firstCall.returnValue;
    adapterRequest.fireSuccess(MockBluetooth.defaultAdapter);
  };

  suite('Activity Routing for NfcHandoverManager', function() {
    var activityInjection1;
    var activityInjection2;

    setup(function() {
      activityInjection1 = {
        type: 'techDiscovered',
        techList: ['NFC_A','NDEF'],
        records: NDEFUtils.encodeHandoverSelect(
                                    '00:0D:44:E7:95:AB', NDEF.CPS_ACTIVE,
                                    NfcUtils.fromUTF8('UE MINI BOOM')),
        sessionToken: '{e9364a8b-538c-4c9d-84e2-e6ce524afd17}'
      };

      /*
       * This NDEF message contains a simplified pairing record
       * according to Section 4.2.1 Simplified Tag Format for a Single
       * Bluetooth Carrier. The NDEF message encodes the
       * MAC address (4C:21:D0:9F:12:F1) and its name (MBH10).
       * Both parameters are checked via appropriate spies.
       */
      activityInjection2 = {
        type: 'techDiscovered',
        techList: ['NDEF'],
        records: [{
          tnf: NDEF.TNF_MIME_MEDIA,
          type: NDEF.MIME_BLUETOOTH_OOB,
          id: new Uint8Array(),
          payload: new Uint8Array([26, 0, 241, 18, 159, 208, 33, 76, 4, 13, 4,
                                   4, 32, 5, 3, 30, 17, 11, 17, 6, 9, 77, 66,
                                   72, 49, 48])
        }],
        sessionToken: '{e9364a8b-538c-4c9d-84e2-e6ce524afd18}'
      };
    });

    test('nfc/HandoverSelect', function() {
      var spyName = this.sinon.spy(NfcConnectSystemDialog.prototype, 'show');
      var spyPairing = this.sinon.spy(NfcHandoverManager, '_doPairing');

      NfcManager.handleTechnologyDiscovered(activityInjection1);
      assert.isTrue(spyName.withArgs('UE MINI BOOM').calledOnce);
      assert.isTrue(spyPairing.withArgs('00:0D:44:E7:95:AB').calledOnce);
    });

    test('nfc/SimplifiedPairingRecord', function() {
      var spyName = this.sinon.spy(NfcConnectSystemDialog.prototype, 'show');
      var spyPairing = this.sinon.spy(NfcHandoverManager, '_doPairing');

      NfcManager.handleTechnologyDiscovered(activityInjection2);
      assert.isTrue(spyName.withArgs('MBH10').calledOnce);
      assert.isTrue(spyPairing.withArgs('4C:21:D0:9F:12:F1').calledOnce);
    });
  });

  suite('Handover request and select', function() {
    var cps;
    var mac;

    var spyPairing;
    var spySendNDEF;

    setup(function() {
      cps = NDEF.CPS_ACTIVE;
      mac = '01:23:45:67:89:AB';
      spyPairing = this.sinon.spy(NfcHandoverManager, '_doPairing');
      spySendNDEF = this.sinon.spy(MockMozNfc.MockNFCPeer, 'sendNDEF');

      NfcHandoverManager.init();
      invokeBluetoothGetDefaultAdapter();
    });

    teardown(function() {
      spyPairing.restore();
      spySendNDEF.restore();
    });

    test('_handleHandoverRequest(): sends Hs message to peer', function() {
      var handoverRequest = NDEFUtils.encodeHandoverRequest(mac, cps);
      NfcHandoverManager._handleHandoverRequest(handoverRequest);

      assert.isTrue(spySendNDEF.calledOnce);

      // Should send self Bluetooth MAC address in return.
      var OOB = Array.apply([], spySendNDEF.firstCall.args[0][1].payload);
      var myMAC = NDEFUtils.parseMAC(
        MockBluetooth.defaultAdapter.address);
      assert.deepEqual(OOB.slice(2, 8), myMAC);

      var ndefRequest = spySendNDEF.returnValues[0];
      ndefRequest.fireSuccess();
      assert.isTrue(NfcHandoverManager.incomingFileTransferInProgress);
    });

    test('_handleHandoverSelect() attempts to pair BT devices', function() {
      var handoverSelect = NDEFUtils.encodeHandoverSelect(mac, cps);
      NfcHandoverManager._handleHandoverSelect(handoverSelect);

      assert.isTrue(spyPairing.calledOnce);
      assert.equal(mac, spyPairing.firstCall.args[0]);
    });
  });

  /*
   * Outbound file transfer is a two-phase process: sending handover request
   * to peer device (result of 'nfc-manager-senf-file' message) and sending
   * file over Bluetooth (result of peer device responding with hadover
   * select). Those two phases are tested in two separate test cases.
   */
  suite('File transfer', function() {
    var spySendNDEF;

    var fileRequest;

    setup(function() {
      MockBluetooth.enabled = true;

      spySendNDEF = this.sinon.spy(MockMozNfc.MockNFCPeer, 'sendNDEF');

      fileRequest = {
        session: '0da40690-518c-469b-8345-dc7875cf77eb',
        blob: 'Lorem ipsum',
        requestId: 'request-01'
      };

      NfcHandoverManager.init();
      invokeBluetoothGetDefaultAdapter();
    });

    teardown(function() {
      MockBluetooth.enabled = false;

      spySendNDEF.restore();
      NfcHandoverManager.sendFileQueue = [];
    });

    test('"nfc-manager-send-file" results in handover request sent to peer',
      function() {

      fileRequest.sessionToken = fileRequest.session;
      MockNavigatormozSetMessageHandler.mTrigger(
        'nfc-manager-send-file', fileRequest);

      assert.isTrue(spySendNDEF.calledOnce);

      // CPS should be either active or activating. In this test
      // MockBluetooths sets it to active, so assert that.
      var cps = spySendNDEF.firstCall.args[0][0].payload[13];
      assert.equal(cps, NDEF.CPS_ACTIVE);

      // OOB payload should contain MAC address of this device's
      // default Bluetooth Adapter (it's being sent to a peer).
      var OOB = Array.apply([], spySendNDEF.firstCall.args[0][1].payload);
      var myMAC = NDEFUtils.parseMAC(
        MockBluetooth.defaultAdapter.address);
      assert.deepEqual(OOB.slice(2, 8), myMAC);

      assert.isTrue(NfcHandoverManager.isHandoverInProgress());

      var ndefReq = spySendNDEF.returnValues[0];
      ndefReq.fireSuccess();
      assert.equal(1, NfcHandoverManager.sendFileQueue.length);
    });

    test('Aborts when sendNDEF() fails.', function() {
      fileRequest.sessionToken = fileRequest.session;
      MockNavigatormozSetMessageHandler.mTrigger(
        'nfc-manager-send-file', fileRequest);

      var spyNotify = this.sinon.spy(MockMozNfc, 'notifySendFileStatus');

      var ndefReq = spySendNDEF.returnValues[0];
      ndefReq.fireError();
      assert.equal(0, NfcHandoverManager.sendFileQueue.length);
      assert.isTrue(spyNotify.calledOnce);
      assert.equal(spyNotify.firstCall.args[0], 1);
    });

    test('Aborts when getNFCPeer() fails during file send.', function() {
      fileRequest.sessionToken = fileRequest.session;
      var stubGetPeer = this.sinon.stub(MockMozNfc, 'getNFCPeer').throws();
      var spyNotify = this.sinon.spy(MockMozNfc, 'notifySendFileStatus');
      MockNavigatormozSetMessageHandler.mTrigger(
        'nfc-manager-send-file', fileRequest);
      assert.isTrue(stubGetPeer.calledOnce);
      assert.isTrue(spyNotify.calledOnce);
      assert.equal(spyNotify.firstCall.args[0], 1);
    });

    test('Aborts when getNFCPeer() fails during file receive.', function() {
      var cps = NDEF.CPS_ACTIVE;
      var mac = '01:23:45:67:89:AB';
      var handoverRequest = NDEFUtils.encodeHandoverRequest(mac, cps);
      var stubGetPeer = this.sinon.stub(MockMozNfc, 'getNFCPeer').throws();
      NfcHandoverManager._handleHandoverRequest(handoverRequest);
      assert.isTrue(stubGetPeer.calledOnce);
      assert.isTrue(spySendNDEF.notCalled);
    });

    test('Handover select results in file being transmitted over Bluetooth',
      function() {

      fileRequest.onsuccess = sinon.stub();
      NfcHandoverManager.sendFileQueue.push(fileRequest);

      var spySendFile = this.sinon.spy(MockBluetoothTransfer,
        'sendFileViaHandover');

      var select = NDEFUtils.encodeHandoverSelect(
        '01:23:45:67:89:AB', NDEF.CPS_ACTIVE);
      NfcHandoverManager._handleHandoverSelect(select);

      assert.isTrue(spySendFile.calledOnce);
      assert.equal(fileRequest.onsuccess.callCount, 0);

      // File transfer finished.
      var sendFileRequest = spySendFile.returnValues[0];
      sendFileRequest.fireSuccess();

      assert.isTrue(fileRequest.onsuccess.calledOnce);
    });
  });

  suite('Action queuing when Bluetooth disabled', function() {
    setup(function() {
      MockBluetooth.enabled = false;
      NfcHandoverManager.init();
    });

    teardown(function() {
      MockBluetooth.enabled = true;
      NfcHandoverManager.actionQueue.splice(0);
    });

    test('Action are queued when Bluetooth off', function() {
      assert.equal(0, NfcHandoverManager.actionQueue.length);

      var action = {};
      NfcHandoverManager._doAction(action);

      assert.equal(1, NfcHandoverManager.actionQueue.length);
    });

    test('Actions executed when Bluetooth turned on', function() {
      var action = {
        callback: this.sinon.spy(),
        args: ['lorem', 100]
      };

      NfcHandoverManager._doAction(action);

      window.dispatchEvent(new CustomEvent('bluetooth-adapter-added'));
      invokeBluetoothGetDefaultAdapter();

      assert.isTrue(action.callback.calledOnce);
      assert.deepEqual(action.args, action.callback.getCall(0).args);
    });
  });

  suite('Restore state of Bluetooth adapter', function() {
    var realBluetoothTransfer;
    var spySendNDEF;
    var spySendFileViaHandover;
    var spyBluetoothEnabledObserver;
    var mockFileRequest;

    setup(function() {
      this.sinon.useFakeTimers();
      realBluetoothTransfer = window.BluetoothTransfer;
      window.BluetoothTransfer = window.MockBluetoothTransfer;

      mockFileRequest = {
          session: '48c0c37c-e94c-11e3-beca-00a0cca16458',
          blob: new Blob(),
          requestId: 'req-id-1'
      };

      spyBluetoothEnabledObserver = sinon.spy(function(event) {
        MockBluetooth.enabled = event.settingValue;
      });
      MockNavigatorSettings.addObserver('bluetooth.enabled',
                                        spyBluetoothEnabledObserver);

      spySendNDEF = sinon.spy(MockMozNfc.MockNFCPeer, 'sendNDEF');
      spySendFileViaHandover = sinon.spy(MockBluetoothTransfer,
        'sendFileViaHandover');
    });

    teardown(function() {
      window.BluetoothTransfer = realBluetoothTransfer;
      spySendNDEF.restore();
      spySendFileViaHandover.restore();
      MockNavigatorSettings.removeObserver('bluetooth.enabled');
    });

    var initiateFileTransfer = function() {
      NfcHandoverManager.init();
      NfcHandoverManager.handleFileTransfer(mockFileRequest.session,
                                            mockFileRequest.blob,
                                            mockFileRequest.requestId);

      window.dispatchEvent(new CustomEvent('bluetooth-adapter-added'));
      invokeBluetoothGetDefaultAdapter();

      // This will actually send the handover request message.
      var ndefRequest = spySendNDEF.returnValues[0];
      ndefRequest.fireSuccess();
    };

    var finalizeFileTransfer = function() {
      var hs = NDEFUtils.encodeHandoverSelect('11:22:33:44:55:66',
        NDEF.CPS_ACTIVE);
      NfcHandoverManager._handleHandoverSelect(hs);
      spySendFileViaHandover.firstCall.returnValue.fireSuccess();
    };

    test('Send file with BT enabled',
      function() {

      MockBluetooth.enabled = true;
      MockBluetoothTransfer.sendFileQueueEmpty = true;

      initiateFileTransfer();
      assert.isTrue(MockBluetooth.enabled);
      finalizeFileTransfer();

      assert.equal(spyBluetoothEnabledObserver.callCount, 0);
    });

    test('Send file with BT disabled and empty send file queue',
      function() {

      MockBluetooth.enabled = false;
      MockBluetoothTransfer.sendFileQueueEmpty = true;

      initiateFileTransfer();
      finalizeFileTransfer();

      assert.equal(spyBluetoothEnabledObserver.callCount, 2);
      assert.isTrue(spyBluetoothEnabledObserver.getCall(0)
                                                .args[0].settingValue);
      assert.isFalse(spyBluetoothEnabledObserver.getCall(1)
                                                .args[0].settingValue);
    });

    test('Send file with BT disabled and non-empty send file queue',
      function() {

      MockBluetooth.enabled = false;
      MockBluetoothTransfer.sendFileQueueEmpty = false;

      initiateFileTransfer();
      finalizeFileTransfer();

      // BT should still be enabled as there is another file transfer
      // in progress.
      assert.equal(spyBluetoothEnabledObserver.callCount, 1);
      assert.isTrue(spyBluetoothEnabledObserver.getCall(0)
                                               .args[0].settingValue);

      // Now finalize the second transfer (the one not initiated
      // via NFC handover)
      MockBluetoothTransfer.sendFileQueueEmpty = true;
      var details = {received: false,
                     success: true,
                     viaHandover: false};
      NfcHandoverManager.transferComplete(details);

      assert.equal(spyBluetoothEnabledObserver.callCount, 2);
      assert.isFalse(spyBluetoothEnabledObserver.getCall(1)
                                                .args[0].settingValue);
    });

    test('Timeout outgoing file transfer', function() {
      MockBluetooth.enabled = true;
      MockBluetoothTransfer.sendFileQueueEmpty = true;
      var spyCancel = this.sinon.spy(NfcHandoverManager,
                                     '_cancelSendFileTransfer');

      initiateFileTransfer();
      assert.isTrue(MockBluetooth.enabled);
      this.sinon.clock.tick(NfcHandoverManager.responseTimeoutMillis);
      assert.isTrue(spyCancel.calledOnce);
    });

    test('Timeout incoming file transfer', function() {
      var cps = NDEF.CPS_ACTIVE;
      var mac = '01:23:45:67:89:AB';
      var session = 'session-1';
      var handoverRequest = NDEFUtils.encodeHandoverRequest(mac, cps);
      MockBluetooth.enabled = true;
      MockBluetoothTransfer.sendFileQueueEmpty = true;
      var spyCancel = sinon.spy(NfcHandoverManager,
                                '_cancelIncomingFileTransfer');

      NfcHandoverManager._handleHandoverRequest(handoverRequest, session);
      this.sinon.clock.tick(NfcHandoverManager.responseTimeoutMillis);
      assert.isTrue(spyCancel.calledOnce);
    });
  });

  suite('tryHandover', function() {
    var session = 'sessionToken';

    // simplified pairing record
    var spr;
    // handover select record
    var hsr;
    // handover request record
    var hrr;

    var uriRecord;
    var mimeRecord;

    var stubHandleSPR;
    var stubHandleHSR;
    var stubHandleHRR;

    setup(function() {
      spr = {
        tnf: NDEF.TNF_MIME_MEDIA,
        type: NDEF.MIME_BLUETOOTH_OOB,
        id: new Uint8Array([1]),
        payload: new Uint8Array([1])
      };

      hsr = {
        tnf: NDEF.TNF_WELL_KNOWN,
        type: NDEF.RTD_HANDOVER_SELECT,
        id: new Uint8Array([2]),
        payload: new Uint8Array([2])
      };

      hrr = {
        tnf: NDEF.TNF_WELL_KNOWN,
        type: NDEF.RTD_HANDOVER_REQUEST,
        id: new Uint8Array([3]),
        payload: new Uint8Array([3])
      };

      uriRecord = {
        tnf: NDEF.TNF_WELL_KNOWN,
        type: NDEF.RTD_URI,
        id: new Uint8Array([4]),
        payload: new Uint8Array([4])
      };

      mimeRecord = {
        tnf: NDEF.TNF_MIME_MEDIA,
        type: 'text/plain',
        id: new Uint8Array([5]),
        payload: new Uint8Array([5])
      };

      stubHandleSPR = this.sinon.stub(NfcHandoverManager,
                                      '_handleSimplifiedPairingRecord');
      stubHandleHSR = this.sinon.stub(NfcHandoverManager,
                                      '_handleHandoverSelect');
      stubHandleHRR = this.sinon.stub(NfcHandoverManager,
                                      '_handleHandoverRequest');
    });

    teardown(function() {
      stubHandleSPR.restore();
      stubHandleHSR.restore();
      stubHandleHRR.restore();
    });

    test('simplified pairing record', function() {
      var result = NfcHandoverManager.tryHandover([spr], session);
      assert.isTrue(result, 'result');
      assert.isTrue(stubHandleSPR.withArgs([spr]).calledOnce, 'method');
    });

    test('handover select record', function() {
      var result = NfcHandoverManager.tryHandover([hsr], session);
      assert.isTrue(result, 'result');
      assert.isTrue(stubHandleHSR.withArgs([hsr]).calledOnce, 'method');
    });

    test('handover request record', function() {
      var result = NfcHandoverManager.tryHandover([hrr], session);
      assert.isTrue(result, 'result');
      assert.isTrue(stubHandleHRR.withArgs([hrr], session).calledOnce,
                                           'method');
    });

    test('regular records', function() {
      var result = NfcHandoverManager.tryHandover([uriRecord], session);
      assert.isFalse(result, 'regular URI record');

      result = NfcHandoverManager.tryHandover([mimeRecord], session);
      assert.isFalse(result, 'regular MIME record');
    });

    test('multiple handover records, only first handled', function() {
      var result = NfcHandoverManager.tryHandover([spr, hsr], session);
      assert.isTrue(result, 'result');
      assert.isTrue(stubHandleSPR.withArgs([spr, hsr]).calledOnce, 'handled');
      assert.isFalse(stubHandleHSR.called, 'not handled');
    });

    test('multiple records, handover record second, not handled', function() {
      var result = NfcHandoverManager.tryHandover([uriRecord, hsr], session);
      assert.isFalse(result, 'result');
      assert.isFalse(stubHandleHSR.called, 'not handled');
    });
  });
});
