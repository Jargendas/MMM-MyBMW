var NodeHelper = require("node_helper");
const spawn = require("child_process").spawn;

module.exports = NodeHelper.create({

  start: function () {
    console.log("Starting node_helper for module: " + this.name);
    this.bmwInfo = {};
    this.config = {};
    this.resourceLocked = false;
  },

  socketNotificationReceived: async function (notification, payload) {

    var self = this;
    var vin = payload.vin;

    if (notification == "MMM-MYBMW-CONFIG") {
      self.config[vin] = payload;
      self.bmwInfo[vin] = null;
    } else if (notification == "MMM-MYBMW-GET") {
      console.log('MMM-MyBMW: Updating data for ' + vin);
      const config = self.config[vin];

      while (self.resourceLocked) {
        console.log('MMM-MyBMW: Resource is locked, waiting...');
        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
        await delay(10000);
      }
      self.resourceLocked = true;
      const pythonProcess = spawn('python3',["modules/MMM-MyBMW/getMyBMWData.py", config.email, config.password, config.vin, config.region, config.hCaptchaToken, config.authStorePath]);

      pythonProcess.stdout.on('data', (data) => {
        self.bmwInfo[vin] = JSON.parse(data);
        self.sendResponse(payload);
        self.resourceLocked = false;
      });

      pythonProcess.stderr.on('data', (data) => {
        console.error(`bimmer_connected error: ${data}`);
        self.resourceLocked = false;
      });

      setTimeout(function(){self.resourceLocked = false;}, 20000);
    }
  },

  sendResponse: function (payload) {
    this.sendSocketNotification("MMM-MYBMW-RESPONSE" + payload.instanceId, this.bmwInfo[payload.vin]);
  },

});
