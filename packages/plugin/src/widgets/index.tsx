import { declareIndexPlugin } from '@remnote/plugin-sdk';

import '../style.css';
import '../index.css'; // import <widget-name>.css

import { onActivate, onDeactivate } from '../bridge/indexPlugin';

declareIndexPlugin(onActivate, onDeactivate);
