import { createApp } from 'vue';
//import VueRouter from 'vue-router/dist/vue-router.global.js';
//import mitt from 'mitt/dist/mitt.mjs';

//import BalmUI from 'balm-ui/dist/balm-ui.d.ts'; // Official Google Material Components
//import BalmUI from 'balm-ui/dist/balm-ui.esm.js'; // Official Google Material Components
//import BalmUI from 'balm-ui/dist/balm-ui.js'; // Official Google Material Components
import BalmUI from 'balm-ui'; // Official Google Material Components
import BalmUIPlus from 'balm-ui/dist/balm-ui-plus'; // BalmJS Team Material Components
import 'balm-ui/dist/balm-ui.css';

import 'typeface-roboto';
import 'typeface-rajdhani';

import './scss/beet.scss';

import router from './router/index.js';
import store from './store/index';
import BeetServer from './lib/BeetServer';
import RendererLogger from './lib/RendererLogger';
import {i18n} from './lib/i18n.js';

const logger = new RendererLogger;

window.onerror = function (msg, url, lineNo, columnNo, error) {
  logger.error(error);
  console.log(error);
  return false;
};

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
  // application specific logging, throwing an error, or other logic here
});

store.dispatch("SettingsStore/loadSettings");
store.dispatch("WhitelistStore/loadWhitelist");

//const emitter = mitt();
const app = createApp({});
//app.provide('emitter', emitter);

app.config.errorHandler = function (err, vm, info) {
  logger.error(err, vm, info);
  console.log(err);
};

app.use(i18n);

window.t = (key, params) => {
    return i18n.global.t(key, params)
}

//app.use(VueRouter);
app.use(BalmUI, {
    $theme: {
        primary: '#C7088E',
        secondary: '#960069'
    }
});
app.use(BalmUIPlus);

app.use(router);
app.use(store);
app.mount('#app');

BeetServer.initialize(60554, 60555);

//emitter.on('i18n', (data) => {
//  i18n.global.locale.value = data
//});
