const fs = require('fs');
const file = 'c:/repos/club-app/src/screens/ProfileScreen.tsx';
let txt = fs.readFileSync(file, 'utf8');

const search = \  const handleLeaveClub = () => {
    showSnackbar('Leave button pressed');
    Alert.alert('Test', 'Test message');
    return;
    console.log('[ProfileScreen] handleLeaveClub clicked, role:', role);
    if (role === 'owner') {
      console.log('[ProfileScreen] user is owner, showing alert');
      Alert.alert(
        'Cannot Leave',
        'Owners must transfer ownership before leaving this club.',
      );
      return;
    }

    console.log('[ProfileScreen] showing leave confirmation alert');
    Alert.alert('Leave', 'Are you sure?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {\;

const replace = \  const [leaveVisible, setLeaveVisible] = useState(false);

  const handleLeaveClub = () => {
    if (role === 'owner') {
      Alert.alert(
        'Cannot Leave',
        'Owners must transfer ownership before leaving this club.',
      );
      return;
    }
    setLeaveVisible(true);
  };

  const confirmLeaveClub = async () => {
\;

txt = txt.replace(search, replace);
fs.writeFileSync(file, txt);
