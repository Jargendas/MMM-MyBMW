const NodeHelper = require("node_helper");
const Log = require("logger");

const imagedownload = require('image-downloader');
const fs = require('fs');

var loggingLevel=0; // 0: critical, 1: normal, 2: detailed

const bmwApiRoutes = {
  getDeviceCode: {type: 'POST', url: 'https://customer.bmwgroup.com/gcdm/oauth/device/code', headers: {Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded'}, addToken:false},
  getToken: {type: 'POST', url: 'https://customer.bmwgroup.com/gcdm/oauth/token',headers: {Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded'}, addToken:false},
  createContainer: {type: 'POST', url: 'https://api-cardata.bmwgroup.com/customers/containers',headers: {Accept: 'application/json', 'Content-Type': 'application/json', 'x-version':'v1'}, addToken:true},
  deleteContainer: {type: 'DELETE', url: 'https://api-cardata.bmwgroup.com/customers/containers',headers: {Accept: '*/*', 'x-version':'v1'}, addToken:true},
  listContainers: {type: 'GET', url: 'https://api-cardata.bmwgroup.com/customers/containers',headers: {Accept: 'application/json', 'x-version':'v1'}, addToken:true},
  readVehicleData: {type: 'GET', url: 'https://api-cardata.bmwgroup.com/customers/vehicles',headers: {Accept: 'application/json', 'x-version':'v1'}, addToken:true},
}

const containerName='MM_data'; // name for our container in BMW's CarData API

var sessionInfoFile=null;
var containerAttached={};

module.exports = NodeHelper.create({
  start: async function () {
    log(0,"Starting node_helper for module: " + this.name);   
    this.sessionInfo = {};
    this.config = {};
    this.bmwInfo = {};
   
    sessionInfoFile=this.path+'/bmw_session_info.json';
    log(1,`attempting to load session info from file ${sessionInfoFile}`);
    if (fs.existsSync(sessionInfoFile)) {
      this.sessionInfo=await JSON.parse(fs.readFileSync(sessionInfoFile,'utf8'));
    }
    log(2,'initial content of sessionInfo structure:');
    log(2,JSON.stringify(this.sessionInfo));
  },
 
  socketNotificationReceived: async function (notification, payload) {
    var self = this;
    var vin = payload.vin;
    if (notification == "MMM-BMWCARDATA-CONFIG") {
      log(1,'config received from module');
      self.config[vin] = payload;
      if(self.sessionInfo[vin])
        self.sessionInfo[vin].client_id=payload.clientId;
      else
        self.sessionInfo[vin]={client_id:payload.clientId};
      self.bmwInfo[vin]={error:null};
      if(payload.loggingLevel)
        loggingLevel=payload.loggingLevel;
      log(2,'loaded config values:');
      log(2,JSON.stringify(self.config));
      log(2,'current sessionInfo structure:');
      log(2,JSON.stringify(self.sessionInfo));
    } else if (notification == "MMM-BMWCARDATA-GET") {
      log(1,'Updating data for ' + vin);
      const config = self.config[vin];
      res=await getTelematicData(this,vin);
      log(1,'requested telematic data, result:')
      if(res.data) {
        log(1,JSON.stringify(res.data));
        locked=((res.data.telematicData["vehicle.cabin.door.lock.status"].value==='SECURED')||(res.data.telematicData["vehicle.cabin.door.lock.status"].value==='LOCKED'));
        this.bmwInfo[vin].mileage=res.data.telematicData["vehicle.vehicle.travelledDistance"].value;
        this.bmwInfo[vin].fuelRange=res.data.telematicData["vehicle.drivetrain.lastRemainingRange"].value;
        this.bmwInfo[vin].electricRange=res.data.telematicData["vehicle.drivetrain.electricEngine.kombiRemainingElectricRange"].value;
        this.bmwInfo[vin].chargingLevelHv=res.data.telematicData["vehicle.drivetrain.electricEngine.charging.level"].value;
        this.bmwInfo[vin].doorLock=locked;
        imagePath='modules/MMM-BMWCarData/car-'+vin+'.png';
        this.bmwInfo[vin].imageUrl=imagePath;
        this.bmwInfo[vin].updateTime=new Date(Date.now()).getTime();
        log(2,'retrieved vehicle data, now sending it on');
        log(2,JSON.stringify(this.bmwInfo));
        self.sendResponse(payload);
      }
      else
        log(1,'<none>, did not send it to module');     
    }
  },
  sendResponse: function (payload) {
    this.sendSocketNotification("MMM-BMWCARDATA-RESPONSE" + payload.instanceId, this.bmwInfo[payload.vin]);
  },
})

function log(level,message) {
  if(level<=loggingLevel)
    Log.log('MMM-BMWCarData helper: '+message);
}

function sendError(self,error) {
  log(0,'error message sent to module: '+error);
  self.sendSocketNotification("MMM-BMWCARDATA-ERROR",error);
}

async function getAccessToken(self,vin){
  log(1,'getAccessToken() called');
  currentTime=new Date(Date.now()).getTime()
  log(2,`Current time: ${currentTime}`)
  if(!self.sessionInfo[vin]||!self.sessionInfo[vin].token_expiry||(self.sessionInfo[vin].refresh_expiry<currentTime)) {
    log(1,'existing refresh token has expired or is not available, interactive user authentication on BMW portal will be required');
    res=await getDeviceCode(self,vin);
    if(!res||!res.data)
      return {error: 'could not obtain device code'};
    fs.writeFile(sessionInfoFile,JSON.stringify(self.sessionInfo),err=>{if(err){log(0,err)}});
    log(0,`Please visit ${res.data.verification_uri} within the next ${res.data.expires_in} seconds, log in (if required), and enter the following code:\n${res.data.user_code}`)
    sendError(self,`Authorization required. Visit <br>${res.data.verification_uri}<br> within ${res.data.expires_in} seconds<br>Code: ${res.data.user_code}`)
    log(2,'start polling for user to provide authorization');
    res=await getFirstToken(self,vin,0);
    if(!res||!res.data)
      return {error: 'could not obtain first token'};
    log(2,'attempting to retrieve vehicle image');
    res=await getVehicleImage(self,vin);   
    if(!res||!res.data)
      return {error: 'could not retrieve vehicle image'};
    log(2,'attempting to create remote data container');
    res=await attachContainer(self,vin,true);  // on re-authentication, we remove the container just to make sure it will contain what we expect
    if(!res||!res.data)
      return {error: 'could not create container'};
    sendError(self,'');//all is well, time to clear the instruction to provide authorization
    log(1,'initial token flow successful, providing token');
    return {data:self.sessionInfo[vin].access_token};
  }
  if(!self.sessionInfo[vin].token_expiry||(self.sessionInfo[vin].token_expiry<currentTime)) {
    log(1,'existing token has expired');
    res=await refreshToken(self,vin);
    if(!res||!res.data)
      return {error: 'could not refresh token'};
    log(1,'refresh token flow successful, providing token');
    return {data:self.sessionInfo[vin].access_token};
  }
  log(1,'token requested, but no renewals required, will provide current token')
  return {data:self.sessionInfo[vin].access_token};
}

async function getDeviceCode(self,vin){
  log(1,'getDeviceCode() called');
  bodydata={ 
    client_id: self.sessionInfo[vin].client_id,
    response_type: 'device_code',
    scope: 'authenticate_user openid cardata:api:read cardata:streaming:read',
    code_challenge: '6xSQkAzH8oEmFMieIfFjAlAsYMS23uhOCXg70Gf13p8',
    code_challenge_method: 'S256'
  }
  bodydata_string=new URLSearchParams(Object.entries(bodydata)).toString();
  res=await bmwApiCall(self,vin,bmwApiRoutes.getDeviceCode,'',bodydata_string);
  if (res.status!=200) {
    log(0,`Error status ${res.status} on BMW API call to obtain device code`);
    return;
  } 
  try {
    log(2,JSON.stringify(res.data));
    if(!self.sessionInfo[vin])
      self.sessionInfo[vin]={};
    self.sessionInfo[vin].device_code=res.data.device_code;
    return {data: res.data}
  }
  catch(e) {
    log(0,`Error in getDeviceCode: ${e.message}`)
    return {error: `${e.message}`};
  }   
}

async function getFirstToken(self,vin,iteration){
  log(1,`getFirstToken() called, iteration# ${iteration}`);
  // we assume the user is aware that he should log in to the BMW website as instucted in the previous step
  // and we are now going to poll for a while until user has successfully logged in
  const maxIterations = 9;
  const pollingInterval = 30; 
  bodydata={ 
    client_id: self.sessionInfo[vin].client_id,
    device_code: self.sessionInfo[vin].device_code,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    code_verifier: 'Lc-kVofs3uj2Aj5Yrpd8X8Sa0N6tGmp4VIjflKSbFSQ'
  }
  bodydata_string=new URLSearchParams(Object.entries(bodydata)).toString();
  res=await bmwApiCall(self,vin,bmwApiRoutes.getToken,'',bodydata_string);
  log(1,`Status ${res.status} on BMW API call to obtain first token`);
  if(res.status===200){
    try{     
      log(0,JSON.stringify(res.data));
      self.sessionInfo[vin].access_token=res.data.access_token;
      self.sessionInfo[vin].refresh_token=res.data.refresh_token;
      self.sessionInfo[vin].id_token=res.data.id_token;
      exptime=new Date(Date.now()).getTime()+res.data.expires_in*1000;
      self.sessionInfo[vin].token_expiry=exptime;
      exptime=new Date(Date.now()).getTime()+1200000*1000;// hard coded limit; BMW website establishes 1.209.600 seconds (two weeks)
      self.sessionInfo[vin].refresh_expiry=exptime;
      fs.writeFile(sessionInfoFile,JSON.stringify(self.sessionInfo),err=>{if(err){log(0,err)}});         
      self.bmwInfo[vin].error=null;
      return {data: res.data};
    }   
    catch(e) {
      log(0,`Exception in getFirstToken: ${e.message}`)
      return {error: `${e.message}`};
    }
  }
  else{
    log(2,'Non-success statusword while polling for first token');
    if(iteration>maxIterations) {
      log(0,'Too many iterations, giving up');
      return {error: 'Too many iterations while polling for first token'};
    }
    log(1,`Will retry in ${pollingInterval} seconds`);
    await new Promise((resolve) => {setTimeout(resolve, 30*1000)});
    res= await getFirstToken(self,vin,iteration+1);
    return res;
  }
}

async function refreshToken(self,vin,iteration){
  log(1,'refreshToken() called'); 
  bodydata={ 
    client_id: self.sessionInfo[vin].client_id,
    refresh_token: self.sessionInfo[vin].refresh_token,
    grant_type: 'refresh_token',
  }
  bodydata_string=new URLSearchParams(Object.entries(bodydata)).toString();
  res=await bmwApiCall(self,vin,bmwApiRoutes.getToken,'',bodydata_string);
  log(1,`Status ${res.status} on BMW API call to refresh token`);
  if(res.status===200){
    try{     
      log(2,JSON.stringify(res.data));
      self.sessionInfo[vin].access_token=res.data.access_token;
      self.sessionInfo[vin].refresh_token=res.data.refresh_token;
      self.sessionInfo[vin].id_token=res.data.id_token;
      exptime=new Date(Date.now()).getTime()+res.data.expires_in*1000;
      self.sessionInfo[vin].token_expiry=exptime;
      exptime=new Date(Date.now()).getTime()+1200000*1000;// hard coded limit; BMW website establishes 1.209.600 seconds (two weeks)
      self.sessionInfo[vin].refresh_expiry=exptime;
      fs.writeFile(sessionInfoFile,JSON.stringify(self.sessionInfo),err=>{if(err){log(0,err)}});         
      return {data: res.data};
    }   
    catch(e) {
      log(0,`Exception in refreshToken: ${e.message}`)
      return {error: `${e.message}`};
    }
  }
  else{
    log(0,'Non-success statusword while refreshing token');
    return {error:'Non-success statusword while refreshing token'};
  }
}

async function listContainers(self,vin){
  log(1,'listContainers() called');
  res=await bmwApiCall(self,vin,bmwApiRoutes.listContainers);
  log(1,`Status ${res.status} on BMW API call to list containers`);
  if(res.status===200){
    try{     
      log(1,JSON.stringify(res.data));
      return {data: res.data};
    }   
    catch(e) {
      log(0,`Exception while retrieving Container list: ${e.message}`)
      return {error: `${e.message}`};
    }
  } 
}

async function createContainer(self,vin){
  log(1,'createContainer() called'); 
 
  var bodydata={ 
    name: containerName,
    purpose: "data for display on Magic Mirror MMM-BMWCardData module",
    technicalDescriptors: [
      "vehicle.drivetrain.fuelSystem.remainingFuel",
      "vehicle.drivetrain.fuelSystem.level",
      "vehicle.vehicle.travelledDistance",
      "vehicle.cabin.door.lock.status",
      "vehicle.drivetrain.lastRemainingRange",
      "vehicle.drivetrain.electricEngine.kombiRemainingElectricRange",
      "vehicle.powertrain.electric.range.target", // not entirely sure what this is
      "vehicle.drivetrain.electricEngine.charging.level",
      "vehicle.trip.segment.end.drivetrain.batteryManagement.hvSoc", // this is at the end of the last logged trip, it is probably more accurate to use the previous one
      ]
  }
  bodydata_string=JSON.stringify(bodydata);
  log(2,'body data:');
  log(2,bodydata_string);
  res=await bmwApiCall(self,vin,bmwApiRoutes.createContainer,'',bodydata_string);
  log(1,`Status ${res.status} on BMW API call to create container`);
  if(res.status===201){
    try{     
      log(1,JSON.stringify(res.data));
      self.sessionInfo[vin].container_id=res.data.containerId;
      containerAttached[vin]=true;
      fs.writeFile(sessionInfoFile,JSON.stringify(self.sessionInfo),err=>{if(err){log(0,err)}});         
      return {data: res.data};
    }   
    catch(e) {
      log(0,`Exception while creating Container: ${e.message}`)
      return {error: `${e.message}`};
    }
  } 
}

async function attachContainer(self,vin,forceDelete){
  log(1,'attachContainer() called'); 
  if(containerAttached[vin]) {
    log(1,'already attached');
    return {data:self.sessionInfo[vin].container_id};
  }
  res=await listContainers(self,vin);
  if(!res||!res.data) {
    log(0,'error: listContainers() failed');
    return {error:'listContainers() failed'};
  }
  containers=res.data.containers;
  for (var i = 0 ; i < containers.length ; i++)
    if ((containers[i].name===containerName)&&(containers[i].state!=='DELETED')) {
      if (forceDelete) {
        log(1,'existing container found, will delete before re-creating');
        self.sessionInfo[vin].container_id=containers[i].containerId;
        res=await deleteContainer(self,vin);
        if(!res||!res.data) {
          log(0,'error: error while deleting container');
          return {error:'error while deleting container'};
        } 
      } else {
        log(0,'existing container found, will use this');
        self.sessionInfo[vin].container_id=containers[i].containerId;
        containerAttached[vin]=true;
        return {data:self.sessionInfo[vin].container_id}
      }
    }
  // if it did not exist, create it
  res=await createContainer(self,vin);
  if(!res||!res.data) {
    log(0,'error: createContainer() failed');
    return {error:'createContainer() failed'};
  } 
  return {data:self.sessionInfo[vin].container_id}
}

async function deleteContainer(self,vin){
  log(1,'deleteContainer() called');
  res=await bmwApiCall(self,vin,bmwApiRoutes.deleteContainer,'/'+self.sessionInfo[vin].container_id);
  log(1,`Status ${res.status} on BMW API call to delete container`);
  if(res.status===204){
    try{     
      return {data: 'succes'};
    }   
    catch(e) {
      log(0,`Exception while deleting container: ${e.message}`)
      return {error: `${e.message}`};
    }
  } 
}

async function getTelematicData(self,vin){
  log(1,'getTelematicData() called'); 

  //if(true) {  // dummy response so as not to overload BMW API server while developing
    //log(0,'faking data for telematic data call. do not use this in production.');
    //res=JSON.parse('{"telematicData":{"vehicle.drivetrain.fuelSystem.remainingFuel":{"timestamp":"2025-12-20T16:54:10.000Z","unit":"l","value":"21"},"vehicle.vehicle.travelledDistance":{"timestamp":"2025-12-20T16:54:10.000Z","unit":"km","value":"38402"},"vehicle.drivetrain.fuelSystem.level":{"timestamp":"2025-12-20T16:54:10.000Z","unit":"%","value":"48"},"vehicle.trip.segment.end.drivetrain.batteryManagement.hvSoc":{"timestamp":"2025-12-20T16:52:46.549Z","unit":"%","value":"0"},"vehicle.drivetrain.electricEngine.kombiRemainingElectricRange":{"timestamp":null,"unit":null,"value":null},"vehicle.drivetrain.electricEngine.charging.level":{"timestamp":null,"unit":"%","value":null},"vehicle.drivetrain.lastRemainingRange":{"timestamp":"2025-12-20T16:54:10.000Z","unit":"km","value":"279"},"vehicle.cabin.door.lock.status":{"timestamp":"2025-12-20T16:54:10.000Z","unit":null,"value":"SECURED"},"vehicle.powertrain.electric.range.target":{"timestamp":null,"unit":"km","value":null}}}');
    //return {data:res};
  //}
 
  if(!containerAttached[vin]) {
    log(1,'container not yet attached');
    await attachContainer(self,vin);
  }
  res=await bmwApiCall(self,vin,bmwApiRoutes.readVehicleData,'/'+vin+'/telematicData?containerId='+self.sessionInfo[vin].container_id);
  log(1,`Status ${res.status} on BMW API call to retrieve telematic data`);
  if(res.status===200){
    try{     
      return {data: res.data};
    }   
    catch(e) {
      log(0,`Exception while retrieving telematic data: ${e.message}`)
      return {error: `${e.message}`};
    }
  } 
}

async function getVehicleImage(self,vin){
  log(1,'getVehicleImage() called'); 
  imagePath='modules/MMM-BMWCarData/car-'+vin+'.png';
  if (fs.existsSync(imagePath)) {
    log(1,'Vehicle image already available, will not re-download');
    self.bmwInfo[vin].imageUrl=imagePath;
    return {data:imagePath};
  }
  log(1,'Vehicle image not yet available, will retrieve from BMW servers');
  fullRoute=bmwApiRoutes.readVehicleData.url+'/'+vin+'/image';
  fullHeaders={Accept: '*/*', 'x-version':'v1'};
  token=await getAccessToken(self,vin);
  fullHeaders.Authorization='Bearer '+token.data;
  downloadPath=self.path+'/car-'+vin+'.png';
  imageoptions = {
    url: fullRoute,
    dest: downloadPath,
    headers: fullHeaders,   
  };
  await imagedownload.image(imageoptions)
    .then(({ filename }) => {
      log(1,'Saved downloaded image to', filename);
    })
    .catch((err) => log(0,err));
  self.bmwInfo[vin].imageUrl=imagePath;
  return {data:imagePath};
}

async function bmwApiCall(self,vin,route,endpoint,body){
  
  var fullRoute,fullHeaders;
  if(endpoint)
    fullRoute=route.url+endpoint;
  else
    fullRoute=route.url;
  try {
    log(1,'calling BMW API at '+fullRoute);
    if(body)
      log(2,'body: '+body);
    fullHeaders=route.headers;
    if(route.addToken) {
      token=await getAccessToken(self,vin);
      fullHeaders.Authorization='Bearer '+token.data;
    }
    log(2,'headers: '+await JSON.stringify(fullHeaders));   
    var res = await fetch(fullRoute, {
      method: route.type,
      headers: fullHeaders,     
      body: body
      });
    log(1,'status: '+res.status);
    if (res.status >= 300)
      return {status:res.status, data: null};
    let content_type=res.headers.get('content-type')
    if (content_type == null)
      return {status:res.status, data:null}
    if (content_type.includes('application/json'))
      return {status:res.status, data: await res.json()}
    else
      return {status:res.status, data: await res.text()}
    log(0,`BMW API status error: ${res.status}`)
    return {error: `BMW: ${res.status}`};
  } catch(e) {
    log(0,`BMW API call error: ${e.message}`)
    return {error: `BMW: ${e.message}`};
  }
}
