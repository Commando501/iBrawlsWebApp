import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MainMenuOverlay } from './MainMenuOverlay';
import { DEFAULT_MENU_LOCATION } from './menuNavigation';

function props() {
  return {
    isVisible:true, showAdminDashboard:false,
    navigation:{ location:DEFAULT_MENU_LOCATION, onNavigate:()=>{}, onBack:()=>{} },
    adminDashboard:{account:null},
    header:{appVersion:'test',onlineCount:0},
    childNav:{isAdmin:false},
    primaryPanel:{selectedMap:'championship_stadium',adminSettings:{gameMode:'sandbox'},tournamentRoundCount:3,tournamentKillsToWin:25},
    broadcastRail:{menuSocket:null},
    trainingSetup:{}, settingsOptions:{forceMobileControls:false,onForceMobileControlsChange:()=>{}},
  } as React.ComponentProps<typeof MainMenuOverlay>;
}

test('menu gives all approved destinations a real navigation control and exposes setup actions', () => {
  const html=renderToStaticMarkup(<MainMenuOverlay {...props()}/>);
  for(const label of ['Play','Armory','Theater','Career','Create','Settings','Profile','Social']) assert.ok(html.includes(`>${label}</button>`),label);
  assert.match(html,/Set up training/);
  assert.match(html,/assets\/menu\/training-iron-vanguard\.png/);
  assert.match(html,/Local play available/);
  assert.doesNotMatch(html,/Global Broadcast|Online Players: 1/);
});

test('gameplay hides the menu and its live model surfaces', () => {
  assert.equal(renderToStaticMarkup(<MainMenuOverlay {...props()} isVisible={false}/>),'');
});
