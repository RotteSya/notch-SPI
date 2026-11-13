import {test} from 'node:test';
import assert from 'node:assert/strict';
import {releaseDownload} from '../src/release-download.ts';

const root = 'https://github.com/RotteSya/notch-SPI/releases';
const oldIntel = `${root}/download/v3.1.5/NotchSPI-3.1.5-build43-Intel.dmg`;
const mac = `${root}/download/v3.1.5/NotchSPI3.1.5-mac.dmg`;
const intel = `${root}/download/v3.1.5/NotchSPI3.1.5-intel.dmg`;
const release = {tag_name: 'v3.1.5', assets: [
  {name: 'NotchSPI3.1.5-mac.dmg', browser_download_url: mac},
  {name: 'NotchSPI3.1.5-intel.dmg', browser_download_url: intel},
]};

test('canonical assets select the correct architecture and work after legacy aliases are renamed', () => {
  assert.deepEqual(releaseDownload(release, `${root}/latest/download/NotchSPI.dmg`, 'mac'), {url: mac, filename: 'NotchSPI3.1.5-mac.dmg'});
  assert.deepEqual(releaseDownload(release, oldIntel, 'intel'), {url: intel, filename: 'NotchSPI3.1.5-intel.dmg'});
});
test('legacy aliases retain their exact bytes while public names lose build numbers', () => {
  assert.deepEqual(releaseDownload({tag_name:'v3.1.5',assets:[{browser_download_url:oldIntel}]}, oldIntel, 'intel'), {url:oldIntel,filename:'NotchSPI3.1.5-intel.dmg'});
  const pinned = `${root}/download/v3.1/NotchSPI.dmg`;
  assert.deepEqual(releaseDownload({tag_name:'v3.1',assets:[{name:'NotchSPI.dmg',browser_download_url:pinned}]}, `${root}/latest/download/NotchSPI.dmg`, 'mac'), {url:pinned,filename:'NotchSPI3.1.0-mac.dmg'});
});
test('reject unbound, unstable, mismatched or injectable release identities', () => {
  for (const tag of ['', 'v3.1.5-beta', 'v3.1-intel', '3.1.5\r\nX-Test: unsafe', '3.1.5/evil']) {
    assert.equal(releaseDownload({...release,tag_name:tag},oldIntel,'intel'),null);
  }
  for (const rel of [null, {}, {...release,draft:true}, {...release,prerelease:true}, {...release,assets:[]}, {...release,assets:[null]}, {...release,tag_name:'v3.1.6'}]) {
    assert.equal(releaseDownload(rel,oldIntel,'intel'),null);
  }
  assert.equal(releaseDownload(release,'bad-url','intel'),null);
  for (const url of ['bad-url','file:///private/test',`${root}/download/v3.1.4/NotchSPI3.1.5-intel.dmg`]) {
    assert.equal(releaseDownload({...release,assets:[{name:'NotchSPI3.1.5-intel.dmg',browser_download_url:url}]},oldIntel,'intel'),null);
  }
  assert.equal(releaseDownload({tag_name:'v3.1.5',assets:[release.assets[0]]},oldIntel,'intel'),null);
});
