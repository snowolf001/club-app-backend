$path = "c:\repos\club-app-backend\src\services\clubService.ts"
$content = Get-Content $path -Raw
$idx = $content.IndexOf("  if (queryParts.length === 0) {")
if ($idx -gt -1) {
    $goodPrefix = $content.Substring(0, $idx)
    $newSuffix = @"
  if (queryParts.length === 0) {
    return getClubInfo(clubId);
  }

  values.push(clubId);
  await pool.query(
    ``UPDATE clubs SET `$${queryParts.join(', ')}, updated_at = NOW() WHERE id = `$${idx}``,
    values
  );

  // Clean up old Cloudinary images if they were replaced or removed
  if (oldRow) {
    if (updates.clubLogoUrl !== undefined && oldRow.club_logo_url && oldRow.club_logo_url !== updates.clubLogoUrl) {
      const publicId = extractCloudinaryPublicId(oldRow.club_logo_url);
      if (publicId) deleteImageFromCloudinary(publicId);
    }
    if (updates.paymentMethods !== undefined && oldRow.payment_methods) {
      const oldMethods = Array.isArray(oldRow.payment_methods) ? oldRow.payment_methods : [];
      const newMethods = updates.paymentMethods || [];
      const newUrls = new Set(newMethods.map((m: any) => m.qrImageUrl).filter(Boolean));
      
      for (const oldMethod of oldMethods) {
        if ((oldMethod as any).qrImageUrl && !newUrls.has((oldMethod as any).qrImageUrl)) {
          const publicId = extractCloudinaryPublicId((oldMethod as any).qrImageUrl);
          if (publicId) deleteImageFromCloudinary(publicId);
        }
      }
    }
  }

  return getClubInfo(clubId);
}
"@
    Set-Content $path -Value ($goodPrefix + $newSuffix)
}
