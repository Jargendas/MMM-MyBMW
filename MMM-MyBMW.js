
Module.register("MMM-MyBMW", {
  defaults: {
    hCaptchaToken: '',
    authStorePath: 'modules/MMM-MyBMW/mybmw_auth.json',
    region: 'rest',
    refresh: 15,
    vehicleOpacity: 0.75,
    useUSUnits: false,
    showMileage: true,
    showElectricPercentage: true,
    showElectricRange: true,
    showFuelRange: true,
    showLastUpdated: true,
    lastUpdatedText: "last updated"
  },

  getStyles: function () {
    return ["MMM-MyBMW.css"];
  },

  getScripts: function () {
    return ["moment.js"];
  },

  start: function () {
    Log.info("Starting module: " + this.name);
    this.sendSocketNotification("MMM-MYBMW-CONFIG", this.config);
    this.bmwInfo = {};
    this.getInfo();
    self = this;
    this.updateTimer = setInterval(function(){self.getInfo()}, this.config.refresh * 60 * 1000);
    this.refreshTimer = setInterval(function(){self.updateDom(0)}, 30000); // Update DOM more often for "last updated" field to refresh.
  },

  getInfo: function () {
    this.sendSocketNotification("MMM-MYBMW-GET", {
	    instanceId: this.identifier,
	    vin: this.config.vin
    });
  },

  socketNotificationReceived: function (notification, payload) {
    if (
      notification === "MMM-MYBMW-RESPONSE" + this.identifier &&
      Object.keys(payload).length > 0
    ) {
      this.bmwInfo = payload;
      if (this.config.useUSUnits) {
          this.bmwInfo.mileage = Math.round(this.bmwInfo.mileage/1.60934);
          this.bmwInfo.electricRange = Math.round(this.bmwInfo.electricRange/1.60934);
          this.bmwInfo.fuelRange = Math.round(this.bmwInfo.fuelRange/1.60934);
      }
      this.updateDom(1000);
    }
  },

  faIconFactory: function (icon) {
    var faIcon = document.createElement("i");
    faIcon.classList.add("fas");
    faIcon.classList.add(icon);
    return faIcon;
  },

  getDom: function () {
    var wrapper = document.createElement("div");
	  wrapper.classList.add("bmw-wrapper");

    if (this.config.email === "" || this.config.password === "" || this.config.vin === "") {
      wrapper.innerHTML = "Missing configuration.";
      return wrapper;
    }

    if (Object.keys(this.bmwInfo).length === 0) {
      wrapper.innerHTML = this.translate("LOADING");
      wrapper.className = "dimmed light small";
      return wrapper;
    }

    if (!!this.bmwInfo.error) {
	  wrapper.innerHTML = this.bmwInfo.error;
      wrapper.className = "dimmed light small";
      return wrapper;
    }

    let info = this.bmwInfo;

    var carContainer = document.createElement("div");
    carContainer.classList.add("bmw-container");

    var imageContainer = document.createElement("span");
    var imageObject = document.createElement("img");
    imageObject.setAttribute('src', info.imageUrl);
    imageObject.setAttribute('style', 'opacity: ' + this.config.vehicleOpacity + ';');
    imageContainer.appendChild(imageObject);
    carContainer.appendChild(imageContainer);
    
    wrapper.appendChild(carContainer);

    carContainer = document.createElement("div");
    carContainer.classList.add("bmw-container");

    var battery = document.createElement("span");
    battery.classList.add("battery");
    
    if (this.config.showElectricPercentage  && (info.electricRange != '')) {
      var plugged = document.createElement("span");
      plugged.classList.add("plugged");

      if (info.connectorStatus) {
        plugged.appendChild(this.faIconFactory("fa-bolt"));
      } else {
        //plugged.appendChild(this.faIconFactory("fa-plug"));
        plugged.appendChild(document.createTextNode("\u00a0"));
      }
      battery.appendChild(plugged);

      switch (true) {
        case (info.chargingLevelHv < 25):
          battery.appendChild(this.faIconFactory("fa-battery-empty"));
          break;
        case (info.chargingLevelHv < 50):
          battery.appendChild(this.faIconFactory("fa-battery-quarter"));
          break;
        case (info.chargingLevelHv < 75):
          battery.appendChild(this.faIconFactory("fa-battery-half"));
          break;
        case (info.chargingLevelHv < 100):
          battery.appendChild(this.faIconFactory("fa-battery-three-quarters"));
          break;
        default:
          battery.appendChild(this.faIconFactory("fa-battery-full"));
          break;
      }

      battery.appendChild(document.createTextNode(info.chargingLevelHv + " %"));
    } else {
      battery.appendChild(document.createTextNode("⠀")); // For spacing
    }
    carContainer.appendChild(battery);
    wrapper.appendChild(carContainer);

    var mileage = document.createElement("span");
    mileage.classList.add("mileage");
    if (this.config.showMileage) {
      mileage.appendChild(this.faIconFactory("fa-road"));
      mileage.appendChild(document.createTextNode(info.mileage + (this.config.useUSUnits ? ' mi' : ' km')));
    } else {
      mileage.appendChild(document.createTextNode("\u00a0"));
    }
    carContainer.appendChild(mileage);
    wrapper.appendChild(carContainer);

    carContainer = document.createElement("div");
    carContainer.classList.add("bmw-container");

    var elecRange = document.createElement("span");
    elecRange.classList.add("elecRange");
    if (this.config.showElectricRange && (info.electricRange != '')) {
      elecRange.appendChild(this.faIconFactory("fa-charging-station"));
      elecRange.appendChild(document.createTextNode(info.electricRange + (this.config.useUSUnits ? ' mi' : ' km')));
    } else {
      elecRange.appendChild(document.createTextNode("\u00a0"));
    }
    carContainer.appendChild(elecRange);
    wrapper.appendChild(carContainer);

    carContainer = document.createElement("div");
    carContainer.classList.add("bmw-container");
    carContainer.classList.add("spacer");
    wrapper.appendChild(carContainer);

    carContainer = document.createElement("div");
    carContainer.classList.add("bmw-container");

    var locked = document.createElement("span");
    locked.classList.add("locked");
    if (info.doorLock) {
      locked.appendChild(this.faIconFactory("fa-lock"));
    } else {
      locked.appendChild(this.faIconFactory("fa-lock-open"));
    }
    carContainer.appendChild(locked);
    
    var fuelRange = document.createElement("span");
    fuelRange.classList.add("fuelRange");
    if ((this.config.showFuelRange) && (info.fuelRange != '')) {
      fuelRange.appendChild(this.faIconFactory("fa-gas-pump"));
      fuelRange.appendChild(document.createTextNode(info.fuelRange + (this.config.useUSUnits ? ' mi' : ' km')));
    } else {
      fuelRange.appendChild(document.createTextNode("\u00a0"));
    }
    carContainer.appendChild(fuelRange);
    wrapper.appendChild(carContainer);
    
    carContainer = document.createElement("div");
    carContainer.classList.add("bmw-container");
    carContainer.classList.add("updated");
    
    var updated = document.createElement("span");
    updated.classList.add("updated");
    if (this.config.showLastUpdated) {
      updated.appendChild(this.faIconFactory("fa-info"));
      var lastUpdateText = this.config.lastUpdatedText + " " + moment(info.updateTime).fromNow();
    } else {
      lastUpdateText = "";
    }
    updated.appendChild(document.createTextNode(lastUpdateText));
    carContainer.appendChild(updated);
    wrapper.appendChild(carContainer);
    
    return wrapper;
  }
});
