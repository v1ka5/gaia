'use strict';
/* global SettingsListener */

(function(exports) {

  /**
   * Accessibility enables and disables the screenreader after the user
   * gestures using the hardware buttons of the phone. To toggle the setting.
   * the user must press volume up, then volume down three times in a row.
   * @class Accessibility
   * @requires SettingsListener
   */
  function Accessibility() {}

  Accessibility.prototype = {

    /**
     * How fast the autorepeat is.
     * @type {Number}
     * @memberof Accessibility.prototype
     */
    REPEAT_INTERVAL: 600000,

    /**
     * Maximum interval between initial and final TOGGLE_SCREEN_READER_COUNT
     * volume button presses.
     * @type {Number}
     * @memberof Accessibility.prototype
     */
    REPEAT_BUTTON_PRESS: 15000000,

    /**
     * Number of times the buttons need to be pressed before the screen reader
     * setting is toggled.
     * @type {Number}
     * @memberof Accessibility.prototype
     */
    TOGGLE_SCREEN_READER_COUNT: 6,

    /**
     * Current counter for button presses in short succession.
     * @type {Number}
     * @memberof Accessibility.prototype
     */
    counter: 0,

    /**
     * Next expected event.
     * @type {Object}
     * @memberof Accessibility.prototype
     */
    expectedEvent: {
      type: 'volume-up-button-press',
      timeStamp: 0
    },

    /**
     * Expected complete time stamp.
     * @type {Number}
     * @memberof Accessibility.prototype
     */
    expectedCompleteTimeStamp: 0,

    /**
     * Accessibility settings to be observed.
     * @type {Object} name: value pairs.
     * @memberof Accessibility.prototype
     */
    settings: {
      'accessibility.screenreader': false,
      'audio.volume.content': 15,
      'accessibility.screenreader-rate': 0
    },

    /**
     * Audio used by the screen reader.
     * Note: Lazy-loaded when first needed
     * @type {Object}
     */
    sounds: {
      clickedAudio: null,
      vcKeyAudio: null,
      vcMoveAudio: null
    },

    /**
     * URLs for screen reader audio files.
     * @type {Object}
     */
    soundURLs: {
      clickedAudio: './resources/sounds/screen_reader_clicked.ogg',
      vcKeyAudio: './resources/sounds/screen_reader_virtual_cursor_key.ogg',
      vcMoveAudio: './resources/sounds/screen_reader_virtual_cursor_move.ogg'
    },

    /**
     * Start listening for events.
     * @memberof Accessibility.prototype
     */
    start: function ar_init() {
      window.addEventListener('mozChromeEvent', this);

      // Attach all observers.
      Object.keys(this.settings).forEach(function attach(settingKey) {
        SettingsListener.observe(settingKey, this.settings[settingKey],
          function observe(aValue) {
            this.settings[settingKey] = aValue;
          }.bind(this));
      }, this);
    },

    /**
     * Reset the expected event to defaults.
     * @memberof Accessibility.prototype
     */
    reset: function ar_resetEvent() {
      this.expectedEvent = {
        type: 'volume-up-button-press',
        timeStamp: 0
      };
      this.counter = 0;
    },

    /**
     * Unset speaking flag and set the expected complete time stamp.
     * @param  {?Number} aExpectedCompleteTimeStamp Expected complete time
     * stamp.
     * @memberof Accessibility.prototype
     */
    resetSpeaking: function ar_resetSpeaking(aExpectedCompleteTimeStamp) {
      this.isSpeaking = false;
      this.expectedCompleteTimeStamp = aExpectedCompleteTimeStamp || 0;
    },

    /**
     * Handle volume up and volume down mozChromeEvents.
     * @param  {Object} aEvent a mozChromeEvent object.
     * @memberof Accessibility.prototype
     */
    handleVolumeButtonPress: function ar_handleVolumeButtonPress(aEvent) {
      var type = aEvent.detail.type;
      var timeStamp = aEvent.timeStamp;
      var expectedEvent = this.expectedEvent;
      if (type !== expectedEvent.type || timeStamp > expectedEvent.timeStamp) {
        this.reset();
        if (type !== 'volume-up-button-press') {
          return;
        }
      }

      this.expectedEvent = {
        type: type === 'volume-up-button-press' ? 'volume-down-button-press' :
          'volume-up-button-press',
        timeStamp: timeStamp + this.REPEAT_INTERVAL
      };

      if (++this.counter < this.TOGGLE_SCREEN_READER_COUNT) {
        return;
      }

      this.reset();

      if (!this.isSpeaking && timeStamp > this.expectedCompleteTimeStamp) {
        speechSynthesizer.cancel();
        this.announceScreenReader(function onEnd() {
          this.resetSpeaking(timeStamp + this.REPEAT_BUTTON_PRESS);
        }.bind(this));
        return;
      }

      speechSynthesizer.cancel();
      this.resetSpeaking();
      SettingsListener.getSettingsLock().set({
        'accessibility.screenreader':
          !this.settings['accessibility.screenreader']
      });
    },

    /**
     * Get audio for a screen reader notification.
     * @param  {String} aSoundKey a key for the screen reader audio.
     * @return {Object} Audio object to be played.
     */
    _getSound: function ar__getSound(aSoundKey) {
      if (!this.sounds[aSoundKey]) {
        this.sounds[aSoundKey] = new Audio(this.soundURLs[aSoundKey]);
      }
      return this.sounds[aSoundKey];
    },

    /**
     * Handle accessfu mozChromeEvent.
     * @param  {Object} accessfu details object.
     * @memberof Accessibility.prototype
     */
    handleAccessFuOutput: function ar_handleAccessFuOutput(aDetails) {
      var options = aDetails.options || {};
      switch (aDetails.eventType) {
        case 'vc-change':
          // Vibrate when the virtual cursor changes.
          navigator.vibrate(options.pattern);
          this._getSound(options.isKey ? 'vcKeyAudio' : 'vcMoveAudio').play();
          break;
        case 'action':
          if (aDetails.data[0].string === 'clickAction') {
            // If element is clicked, play 'click' sound instead of speech.
            this._getSound('clickedAudio').play();
            return;
          }
          break;
      }

      this.speak(aDetails.data, null, {
        enqueue: options.enqueue
      });
    },

    /**
     * Handle a mozChromeEvent event.
     * @param  {Object} aEvent mozChromeEvent.
     * @memberof Accessibility.prototype
     */
    handleEvent: function ar_handleEvent(aEvent) {
      switch (aEvent.detail.type) {
        case 'accessfu-output':
          this.handleAccessFuOutput(JSON.parse(aEvent.detail.details));
          break;
        case 'volume-up-button-press':
        case 'volume-down-button-press':
          this.handleVolumeButtonPress(aEvent);
          break;
      }
    },

    /**
     * Based on whether the screen reader is currently enabled, announce the
     * instructions of how to enable/disable it.
     * @param {Function} aCallback A callback after the speech synthesis is
     * completed.
     * @memberof Accessibility.prototype
     */
    announceScreenReader: function ar_announceScreenReader(aCallback) {
      var enabled = this.settings['accessibility.screenreader'];
      this.isSpeaking = true;
      this.speak({
        string: enabled ? 'disableScreenReaderSteps' : 'enableScreenReaderSteps'
      }, aCallback, {enqueue: false});
    },

    /**
     * Use speechSynthesis to speak screen reader utterances.
     * @param  {?Array} aData Speech data before it is localized.
     * @param  {?Function} aCallback aCallback A callback after the speech
     * synthesis is completed.
     * @param  {?Object} aOptions = {} Speech options such as enqueue etc.
     * @memberof Accessibility.prototype
     */
    speak: function ar_speak(aData, aCallback, aOptions = {}) {
      speechSynthesizer.speak(aData, aOptions,
        this.settings['accessibility.screenreader-rate'],
        this.settings['audio.volume.content'] / 15, aCallback);
    }
  };

  /**
   * A speech synthesizer component that handles speech localization and
   * pronunciation.
   * @type {Object}
   */
  var speechSynthesizer = {
    /**
     * Speech Synthesis
     * @type {Object}
     * @memberof speechSynthesizer
     */
    get speech() {
      return window.speechSynthesis;
    },

    /**
     * Speech utterance
     * @type {Object}
     * @memberof speechSynthesizer
     */
    get utterance() {
      return window.SpeechSynthesisUtterance;
    },

    /**
     * Cancle speech if the screen reader is speaking.
     * @memberof speechSynthesizer
     */
    cancel: function ss_cancel() {
      if (this.speech) {
        this.speech.cancel();
      }
    },

    /**
     * Localize speech data.
     * @param  {Object} aDetails Speech data object.
     * @return {String} Localized speech data.
     * @memberof speechSynthesizer
     */
    localize: function ss_localize(aDetails) {
      if (!aDetails || typeof aDetails === 'string') {
        return aDetails;
      }
      var string = aDetails.string;
      var data = {
        count: aDetails.count
      };
      if (!string) {
        return '';
      } else {
        string = 'accessibility-' + string;
      }

      if (aDetails.args) {
        data = aDetails.args.reduce(function(aData, val, index) {
          aData[index] = val;
          return aData;
        }, data);
      }
      return navigator.mozL10n.get(string, data);
    },

    /**
     * Build a complete utterance string by localizing an array of speech data.
     * @param  {?Array} aData Speech data.
     * @return {String} A complete localized string from speech array data.
     * @memberof speechSynthesizer
     */
    buildUtterance: function ss_buildUtterance(aData) {
      if (!Array.isArray(aData)) {
        aData = [aData];
      }
      var words = [], localize = this.localize;
      aData.reduce(function(words, details) {
        var localized = localize(details);
        if (localized) {
          var word = localized.trim();
          if (word) {
            words.push(word);
          }
        }
        return words;
      }, words);

      return words.join(' ');
    },

    /**
     * Utter a message with a speechSynthesizer.
     * @param {?Array} aData A messages array to be localized.
     * @param {JSON} aOptions Options to be used when speaking. For
     * example: {
     *   enqueue: false
     * }
     * @param {Number} aRate Speech rate.
     * @param {Number} aVolume Speech volume.
     * @param {Function} aCallback A callback after the speech synthesis is
     * completed.
     * @memberof speechSynthesizer
     */
    speak: function ss_speak(aData, aOptions, aRate, aVolume, aCallback) {
      if (!this.speech || !this.utterance) {
        if (aCallback) {
          aCallback();
        }
        return;
      }

      if (!aOptions.enqueue) {
        this.cancel();
      }

      var utterance = new this.utterance(this.buildUtterance(aData));
      utterance.volume = aVolume;
      utterance.rate = aRate >= 0 ? aRate + 1 : 1 / (Math.abs(aRate) + 1);
      utterance.addEventListener('end', aCallback);
      this.speech.speak(utterance);
    }
  };

  exports.Accessibility = Accessibility;

}(window));
