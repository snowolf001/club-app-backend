const fs = require('fs');
const file = 'c:/repos/club-app/src/screens/ProfileScreen.tsx';
let txt = fs.readFileSync(file, 'utf8');

const search = \        {/* ===== TRANSFER OWNERSHIP MODAL ===== */}\;

const replace = \        {/* ===== LEAVE CLUB MODAL ===== */}
        <Modal
          visible={leaveVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setLeaveVisible(false)}>
          <View style={styles.alertOverlay}>
            <View style={styles.alertBox}>
              <Text style={styles.alertTitle}>Leave Club</Text>
              <Text style={styles.alertMessage}>
                Leave {currentClub?.name}? You will need to rejoin with a code.
              </Text>
              <View style={styles.alertButtons}>
                <TouchableOpacity
                  style={[styles.alertButton, styles.alertCancelButton]}
                  onPress={() => setLeaveVisible(false)}>
                  <Text style={styles.alertCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.alertButton, styles.alertDangerButton]}
                  onPress={confirmLeaveClub}>
                  <Text style={styles.alertDangerText}>Leave</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* ===== TRANSFER OWNERSHIP MODAL ===== */}\;

txt = txt.replace(search, replace);

const stylesSearch = \    modalOverlay: {\;

const stylesReplace = \    alertOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    alertBox: {
      backgroundColor: c.card,
      borderRadius: 14,
      padding: 24,
      width: '100%',
      maxWidth: 340,
      alignItems: 'center',
    },
    alertTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: c.text,
      marginBottom: 12,
    },
    alertMessage: {
      fontSize: 15,
      color: c.textMuted,
      textAlign: 'center',
      marginBottom: 24,
      lineHeight: 22,
    },
    alertButtons: {
      flexDirection: 'row',
      gap: 12,
      width: '100%',
    },
    alertButton: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 10,
      alignItems: 'center',
    },
    alertCancelButton: {
      backgroundColor: c.surfaceRaised,
    },
    alertCancelText: {
      fontSize: 15,
      fontWeight: '600',
      color: c.text,
    },
    alertDangerButton: {
      backgroundColor: c.danger,
    },
    alertDangerText: {
      fontSize: 15,
      fontWeight: '600',
      color: '#FFF',
    },
    modalOverlay: {\;

txt = txt.replace(stylesSearch, stylesReplace);

fs.writeFileSync(file, txt);
