const fs = require('fs');
const file = 'c:/repos/club-app/src/screens/ProfileScreen.tsx';
let txt = fs.readFileSync(file, 'utf8');
txt = txt.replace(/const handleLeaveClub = \(\) => {[\s\S]*?console.log\('\[ProfileScreen\] showing leave confirmation alert'\);/, 'use strict';
  const handleLeaveClub = () => {
    console.log('[ProfileScreen] handleLeaveClub clicked, role:', role);
    if (role === 'owner') {
      Alert.alert(
        'Cannot Leave',
        'Owners must transfer ownership before leaving this club.',
      );
      return;
    }

    try {
      showSnackbar('Leave club tapped. ' + (currentClub ? currentClub.name : 'no club'));
    } catch(e) {}
    console.log('[ProfileScreen] showing leave confirmation alert'););
fs.writeFileSync(file, txt);
