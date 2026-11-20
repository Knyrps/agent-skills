// Material Web components used by the test page (scripts/lab.mjs). Kept apart from the panel's bundle.
import '@material/web/button/filled-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/button/text-button.js';
import '@material/web/textfield/outlined-text-field.js';
import '@material/web/select/outlined-select.js';
import '@material/web/select/select-option.js';
import '@material/web/checkbox/checkbox.js';
import '@material/web/slider/slider.js';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/dialog/dialog.js';
import '@material/web/menu/menu.js';
import '@material/web/menu/menu-item.js';
import '@material/web/ripple/ripple.js';
import '@material/web/elevation/elevation.js';
import { styles as typescale } from '@material/web/typography/md-typescale-styles.js';

document.adoptedStyleSheets.push(typescale.styleSheet);
