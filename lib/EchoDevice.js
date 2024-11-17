'use strict';

class EchoDevice {
  constructor(name, family, type, serial, volume = 0) {
    this.name = name;
    this.family = family;
    this.type = type;
    this.serial = serial;
    this.volume = volume;
  }

  getSerial() {
    return this.serial;
  }

  getVolume() {
    return this.volume;
  }

  setVolume(newVolume) {
    this.volume = newVolume;
  }

  getIcon(){
    return `ic_${this.family.toLowerCase()}.svg`
  }

  /* getInfo() {
    return `Device Name: ${this.name}, Device Type: ${this.type}`;
  }
 
  static compareDevices(device1, device2) {
    return device1.type === device2.type;
  } */
}

module.exports = EchoDevice;