const fs = require('fs');
const file = 'c:/repos/club-app/src/screens/ProfileScreen.tsx';
let txt = fs.readFileSync(file, 'utf8');
const search = \  const handleLeaveClub = () => {
    console.log('[ProfileScreen] handleLeaveClub clicked, role:', role);
    if (role === 'owner') {\;

const replace = \  const handleLeaveClub = () => {
    showSnackbar('Leave club tapped');
    console.log('[ProfileScreen] handleLeaveClub clicked, role:', role);
    if (role === 'owner') {\;

txt = txt.replace(search, replace);
fs.writeFileSync(file, txt);
