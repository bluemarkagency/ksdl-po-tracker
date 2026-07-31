(() => {
  'use strict';

  const CONFIG = window.PO_TRACKER_CONFIG || {};
  const BASE_URL = String(CONFIG.SUPABASE_URL || '').replace(/\/$/, '');
  const PUBLIC_KEY = CONFIG.SUPABASE_ANON_KEY || '';
  const SESSION_KEY = 'ksdl-po-tracker-session';
  const LANGUAGE_KEY = 'ksdl-logistics-language';
  const NOTE_BUCKET = 'delivery-notes';
  const OPEN_STATUSES = ['Received', 'Scheduled', 'In Transit', 'Partially Delivered'];
  const CLOSED_TRIP_STATUSES = ['Delivered', 'Cancelled'];
  const TRANSLATIONS = {
    en: {
      brand: 'KSDL DISTRIBUTION', pageTitle: 'Dispatch & Invoice Review', loginSubtitle: 'For the accountant and sales representative. Sign in with your authorised business email.',
      language: 'Language', email: 'Email', password: 'Password', signIn: 'Sign in', refresh: 'Refresh', signOut: 'Sign out',
      totalOpenPos: 'Total open POs', value: '{amount} value', received: 'Received', waitingPlanning: 'Waiting for planning', scheduled: 'Scheduled', plannedDispatch: 'Planned for dispatch',
      inTransit: 'In transit', materialOnRoad: 'Material on the road', partiallyDelivered: 'Partially delivered', balancePending: 'Balance still pending',
      searchPlaceholder: 'Search PO, customer, location, invoice or transporter', allOpenStatuses: 'All open statuses', allDates: 'All dates', currentMonth: 'Current month',
      lastMonth: 'Last month', customDates: 'Custom dates', from: 'From', to: 'To', clearFilters: 'Clear filters', openPurchaseOrders: 'Open purchase orders',
      poCustomer: 'PO / Customer', poDate: 'PO Date', status: 'Status', deliveryLocation: 'Delivery location', poValue: 'PO Value', deliveryDate: 'Appointment date',
      invoice: 'Invoice', transport: 'Transport', assigned: 'Assigned', age: 'Age', noOpenPos: 'No open POs found', noOpenPosHelp: 'There are no POs matching the current search and filters.',
      tripDate: 'Trip date*', transporterOwner: 'Transporter / tempo owner*', selectTransporter: 'Select transporter', vehicleNumber: 'Vehicle number', driverName: 'Driver name',
      driverPhone: 'Driver phone', vehicleCost: 'Vehicle / tempo cost (₹)', optional: 'Optional', invoiceCostHeading: 'Invoice and delivery cost for each PO',
      invoiceCostHelp: 'Upload each Tally invoice PDF. The invoice number and date will be filled automatically and checked against the selected PO.',
      poLocation: 'PO / location', invoiceNumber: 'Invoice number*', invoiceDate: 'Invoice date*', invoiceAmount: 'Invoice amount (₹)', invoiceCopy: 'Invoice copy', allocatedCost: 'Allocated cost (₹)', cancel: 'Cancel',
      deliveryCompleted: 'DELIVERY COMPLETED', completeDelivery: 'Complete delivery', finalTransportCost: 'Final transport cost (₹)', signedDeliverySlip: 'Signed delivery slip*',
      finalTotalCost: 'Final total transport cost', completionNote: 'The total is calculated automatically from all PO costs. Each PO will receive its own delivery slip, final cost, invoice details and invoice copy in the owner tracker.',
      step4: 'STEP 4', posInTrip: 'POs in trip', reviewHint: 'Open the PO and invoice copies here to verify that the correct documents are attached.', tripDatePlain: 'Trip date',
      poLocationCopy: 'PO / location / PO copy', tempoDriver: 'Tempo / driver', invoiceAndCopy: 'Invoice / invoice copy', tempoCost: 'Tempo cost', action: 'Action',
      noPosInTrip: 'No POs are in a trip', noPosInTripHelp: 'Tick POs above and create the first delivery plan.', footerNote: 'This shared page lets the accountant verify documents and the sales representative plan and complete trips.',
      connecting: 'Connecting…', loadingPos: 'Loading POs…', couldNotLoad: 'Could not load POs', cloudSynced: 'Cloud synced', setupRequired: 'POs loaded; payment setup required',
      openPoCount: '{count} open PO(s)', activeTripCount: '{count} active trip(s)', createNewTripCount: 'Create new trip ({count})', createTripCount: 'Create trip with {count} PO(s)',
      updateDeliveryPlan: 'UPDATE DELIVERY PLAN', planDelivery: 'PLAN FOR DELIVERY', editTrip: 'Edit trip', createNewTrip: 'Create new trip',
      selectedPos: '{count} PO(s): {pos}', selectPosHelp: 'Tick POs above to plan one delivery trip.', locationPending: 'Location pending', receivedOn: 'Received {date}', days: '{count} days',
      viewPoCopy: 'View PO copy', viewInvoiceCopy: 'View invoice copy', poCopyUnavailable: 'PO copy unavailable', invoiceCopyUnavailable: 'Invoice copy unavailable',
      invoiceAttached: 'Invoice already attached. Upload a file only to replace it.', selectTally: 'Select a Tally PDF to auto-fill.', ownerCorrection: 'Owner correction: {reason}',
      correctionRequested: 'Correction requested', pleaseReview: 'Please review this delivery.', noPosLinked: 'No POs linked', needsCorrection: 'Needs Correction',
      edit: 'Edit', deleteTrip: 'Delete entry', deleteTripConfirm: 'Delete this trip entry? Its POs will return to the open list so the trip can be recreated.', tripDeleted: 'Trip entry deleted. The POs are available for a new trip.', couldNotDeleteTrip: 'Could not delete this trip entry.',
      correctDelivery: 'Correct delivery', saveTripChanges: 'Save trip changes', completeEachDelivery: '{count} PO(s) in this trip — complete each delivery separately.',
      returnedByOwner: '{count} PO(s) returned by the owner — upload the corrected delivery slip and final cost.', tripNotFound: 'Trip not found. Refresh and try again.',
      uploadSlipForPo: 'Upload the signed delivery slip for PO {po}.', completingDelivery: 'Completing delivery…', tripChangesSaved: 'Trip changes saved.',
      tripCreated: 'Trip created — selected POs moved to POs in trip.', correctedResubmitted: 'Corrected delivery resubmitted to the owner.',
      deliveryUpdated: 'Delivery completed — linked POs updated in the owner tracker.', readingInvoice: 'Reading invoice…',
      selectAtLeastOne: 'Select at least one PO first.', waitForInvoice: 'Wait for invoice reading to finish for PO {po}.', replaceWrongInvoice: 'The uploaded invoice does not match PO {po}. Replace it before saving.',
      uploadVerifyInvoice: 'Upload and verify the invoice for PO {po}.', invoiceAmountRequired: 'Enter or verify the invoice amount for PO {po}.', selectTransporterError: 'Select a transporter from the Transporter Master.', editInvoiceFirst: 'Edit the trip and complete the invoice details for PO {po}.',
      planning: 'Planning', pending: 'Pending', delivered: 'Delivered', cancelled: 'Cancelled',
      invoiceCopyRequired: 'Attach the invoice copy before creating the trip.', invoiceTooLarge: 'Invoice copy must be 10 MB or smaller.', slipRequired: 'Upload the signed delivery slip before completing the trip.',
      slipTooLarge: 'Delivery slip must be 10 MB or smaller.', pdfReaderError: 'The PDF reader did not load. Check the internet connection and try again.', tripSetupNotReady: 'Trip setup is not ready. Please contact the administrator.',
      couldNotSaveTrip: 'Could not save the trip.', couldNotComplete: 'Could not complete the delivery.', signInFailed: 'Sign in failed.', notConfigured: 'The app is not configured.', signInAgain: 'Please sign in again.',
      invoiceNumberPlaceholder: 'Invoice number',
      imageInvoiceManual: 'Please select the original Tally invoice PDF. Images and PO copies cannot be read as invoices.', wrongInvoice: 'Wrong invoice: it belongs to PO {actual}, not {expected}.',
      invoiceMatched: '✓ PO {po} matched', verifyInvoice: 'This is not a readable Tally invoice PDF. Please select the original invoice PDF.', savingChanges: 'Saving changes…', creatingTrip: 'Creating trip…',
      createManualPo: '+ Create manual PO', manualPoEyebrow: 'MANUAL PURCHASE ORDER', manualPoTitle: 'Create a new PO',
      manualPoHelp: 'Enter the PO details below. It will be saved as Received and appear in the open PO list immediately.',
      customerName: 'Customer name*', customerPlaceholder: 'Example: DMart', manualPoNumber: 'PO number*', poNumberPlaceholder: 'Enter PO number',
      manualLocation: 'Delivery location*', locationPlaceholder: 'Example: Bopal', manualPoValue: 'PO value (₹)', manualPoDate: 'PO date*',
      poReceivedDate: 'PO received date*', manualDeliveryDate: 'Appointment date', manualAssignedTo: 'Assigned to', assignedPlaceholder: 'Staff name or email',
      poCopy: 'PO copy', poCopyHelp: 'Optional PDF, JPG or PNG up to 10 MB.', remarks: 'Remarks', remarksPlaceholder: 'Any special delivery instructions',
      savePo: 'Save PO', savingPo: 'Saving PO…', manualPoSaved: 'Manual PO saved and added to the open PO list.',
      manualDuplicate: 'This PO number already exists.', manualFileTooLarge: 'PO copy must be 10 MB or smaller.',
      manualFileType: 'PO copy must be a PDF, JPG or PNG file.', couldNotSavePo: 'Could not save the PO.',
      appointmentEyebrow: 'DELIVERY APPOINTMENT', appointmentTitle: 'Update appointment date', appointmentDate: 'Appointment date',
      appointmentHelp: 'Leave blank only when DMart has not confirmed an appointment.', appointmentForPo: 'PO {po} · {location}',
      editAppointment: 'Edit date', saveAppointment: 'Save appointment', savingAppointment: 'Saving…',
      appointmentSaved: 'Appointment date updated.', couldNotSaveAppointment: 'Could not update the appointment date.'
    },
    gu: {
      brand: 'KSDL ડિસ્ટ્રિબ્યુશન', pageTitle: 'ડિસ્પેચ અને ઇન્વૉઇસ ચકાસણી', loginSubtitle: 'એકાઉન્ટન્ટ અને સેલ્સ પ્રતિનિધિ માટે. તમારા અધિકૃત બિઝનેસ ઈમેલથી સાઇન ઇન કરો.',
      language: 'ભાષા', email: 'ઈમેલ', password: 'પાસવર્ડ', signIn: 'સાઇન ઇન', refresh: 'રિફ્રેશ', signOut: 'સાઇન આઉટ',
      totalOpenPos: 'કુલ ઓપન PO', value: '{amount} મૂલ્ય', received: 'મળેલ', waitingPlanning: 'પ્લાનિંગ બાકી', scheduled: 'નિયોજિત', plannedDispatch: 'ડિસ્પેચ માટે આયોજન થયેલ',
      inTransit: 'માર્ગમાં', materialOnRoad: 'માલ રસ્તામાં છે', partiallyDelivered: 'આંશિક ડિલિવરી', balancePending: 'બાકી માલ આપવાનો છે',
      searchPlaceholder: 'PO, ગ્રાહક, સ્થળ, ઇન્વૉઇસ અથવા ટ્રાન્સપોર્ટર શોધો', allOpenStatuses: 'બધા ઓપન સ્ટેટસ', allDates: 'બધી તારીખો', currentMonth: 'ચાલુ મહિનો',
      lastMonth: 'ગયા મહિનો', customDates: 'પસંદગીની તારીખો', from: 'થી', to: 'સુધી', clearFilters: 'ફિલ્ટર સાફ કરો', openPurchaseOrders: 'ઓપન પરચેઝ ઓર્ડર',
      poCustomer: 'PO / ગ્રાહક', poDate: 'PO તારીખ', status: 'સ્થિતિ', deliveryLocation: 'ડિલિવરી સ્થળ', poValue: 'PO મૂલ્ય', deliveryDate: 'અપોઇન્ટમેન્ટ તારીખ',
      invoice: 'ઇન્વૉઇસ', transport: 'ટ્રાન્સપોર્ટ', assigned: 'જવાબદારી', age: 'ઉંમર', noOpenPos: 'કોઈ ઓપન PO મળ્યો નથી', noOpenPosHelp: 'હાલની શોધ અને ફિલ્ટર મુજબ કોઈ PO નથી.',
      tripDate: 'ટ્રિપ તારીખ*', transporterOwner: 'ટ્રાન્સપોર્ટર / ટેમ્પો માલિક*', selectTransporter: 'ટ્રાન્સપોર્ટર પસંદ કરો', vehicleNumber: 'વાહન નંબર', driverName: 'ડ્રાઇવરનું નામ',
      driverPhone: 'ડ્રાઇવર ફોન', vehicleCost: 'વાહન / ટેમ્પો ખર્ચ (₹)', optional: 'વૈકલ્પિક', invoiceCostHeading: 'દરેક PO માટે ઇન્વૉઇસ અને ડિલિવરી ખર્ચ',
      invoiceCostHelp: 'દરેક Tally ઇન્વૉઇસ PDF અપલોડ કરો. ઇન્વૉઇસ નંબર અને તારીખ આપમેળે ભરાશે અને પસંદ કરેલા PO સાથે ચકાસાશે.',
      poLocation: 'PO / સ્થળ', invoiceNumber: 'ઇન્વૉઇસ નંબર*', invoiceDate: 'ઇન્વૉઇસ તારીખ*', invoiceAmount: 'ઇન્વૉઇસ રકમ (₹)', invoiceCopy: 'ઇન્વૉઇસ નકલ', allocatedCost: 'ફાળવેલ ખર્ચ (₹)', cancel: 'રદ કરો',
      deliveryCompleted: 'ડિલિવરી પૂર્ણ', completeDelivery: 'ડિલિવરી પૂર્ણ કરો', finalTransportCost: 'અંતિમ ટ્રાન્સપોર્ટ ખર્ચ (₹)', signedDeliverySlip: 'સહીવાળી ડિલિવરી સ્લિપ*',
      finalTotalCost: 'કુલ અંતિમ ટ્રાન્સપોર્ટ ખર્ચ', completionNote: 'બધા POના ખર્ચ પરથી કુલ આપમેળે ગણાશે. દરેક POની ડિલિવરી સ્લિપ, અંતિમ ખર્ચ, ઇન્વૉઇસ વિગતો અને નકલ ઓનર ટ્રેકરમાં જશે.',
      step4: 'પગલું 4', posInTrip: 'ટ્રિપમાં PO', reviewHint: 'સાચા દસ્તાવેજ જોડાયેલા છે કે નહીં તે તપાસવા PO અને ઇન્વૉઇસની નકલ અહીં ખોલો.', tripDatePlain: 'ટ્રિપ તારીખ',
      poLocationCopy: 'PO / સ્થળ / PO નકલ', tempoDriver: 'ટેમ્પો / ડ્રાઇવર', invoiceAndCopy: 'ઇન્વૉઇસ / ઇન્વૉઇસ નકલ', tempoCost: 'ટેમ્પો ખર્ચ', action: 'કાર્યवाही',
      noPosInTrip: 'કોઈ PO ટ્રિપમાં નથી', noPosInTripHelp: 'ઉપર PO પસંદ કરીને પ્રથમ ડિલિવરી પ્લાન બનાવો.', footerNote: 'આ પેજ પર એકાઉન્ટન્ટ દસ્તાવેજ તપાસી શકે છે અને સેલ્સ પ્રતિનિધિ ટ્રિપ બનાવી અને પૂર્ણ કરી શકે છે.',
      connecting: 'કનેક્ટ થઈ રહ્યું છે…', loadingPos: 'PO લોડ થઈ રહ્યા છે…', couldNotLoad: 'PO લોડ થઈ શક્યા નથી', cloudSynced: 'ક્લાઉડ સિંક થયેલ', setupRequired: 'PO લોડ થયા; પેમેન્ટ સેટઅપ જરૂરી',
      openPoCount: '{count} ઓપન PO', activeTripCount: '{count} સક્રિય ટ્રિપ', createNewTripCount: 'નવી ટ્રિપ બનાવો ({count})', createTripCount: '{count} PO સાથે ટ્રિપ બનાવો',
      updateDeliveryPlan: 'ડિલિવરી પ્લાન સુધારો', planDelivery: 'ડિલિવરીનું આયોજન', editTrip: 'ટ્રિપ સુધારો', createNewTrip: 'નવી ટ્રિપ બનાવો',
      selectedPos: '{count} PO: {pos}', selectPosHelp: 'એક ડિલિવરી ટ્રિપ બનાવવા ઉપર PO પસંદ કરો.', locationPending: 'સ્થળ બાકી', receivedOn: '{date} એ મળેલ', days: '{count} દિવસ',
      viewPoCopy: 'PO નકલ જુઓ', viewInvoiceCopy: 'ઇન્વૉઇસ નકલ જુઓ', poCopyUnavailable: 'PO નકલ ઉપલબ્ધ નથી', invoiceCopyUnavailable: 'ઇન્વૉઇસ નકલ ઉપલબ્ધ નથી',
      invoiceAttached: 'ઇન્વૉઇસ પહેલેથી જોડાયેલ છે. બદલવા માટે જ નવી ફાઇલ અપલોડ કરો.', selectTally: 'આપમેળે ભરવા Tally PDF પસંદ કરો.', ownerCorrection: 'ઓનર સુધારો: {reason}',
      correctionRequested: 'સુધારો માંગેલ', pleaseReview: 'આ ડિલિવરી ફરી તપાસો.', noPosLinked: 'કોઈ PO જોડાયેલ નથી', needsCorrection: 'સુધારો જરૂરી',
      edit: 'સુધારો', deleteTrip: 'એન્ટ્રી કાઢી નાખો', deleteTripConfirm: 'આ ટ્રિપ એન્ટ્રી કાઢી નાખવી છે? તેના PO ફરી ઓપન યાદીમાં આવશે જેથી નવી ટ્રિપ બનાવી શકાય.', tripDeleted: 'ટ્રિપ એન્ટ્રી કાઢી નાખી. PO નવી ટ્રિપ માટે ઉપલબ્ધ છે.', couldNotDeleteTrip: 'આ ટ્રિપ એન્ટ્રી કાઢી શકાયી નથી.',
      correctDelivery: 'ડિલિવરી સુધારો', saveTripChanges: 'ટ્રિપ ફેરફાર સાચવો', completeEachDelivery: 'આ ટ્રિપના {count} PO — દરેક ડિલિવરી અલગથી પૂર્ણ કરો.',
      returnedByOwner: 'ઓનરે {count} PO પાછા મોકલ્યા — સુધારેલી ડિલિવરી સ્લિપ અને અંતિમ ખર્ચ અપલોડ કરો.', tripNotFound: 'ટ્રિપ મળી નથી. રિફ્રેશ કરીને ફરી પ્રયાસ કરો.',
      uploadSlipForPo: 'PO {po} માટે સહીવાળી ડિલિવરી સ્લિપ અપલોડ કરો.', completingDelivery: 'ડિલિવરી પૂર્ણ થઈ રહી છે…', tripChangesSaved: 'ટ્રિપ ફેરફાર સાચવ્યા.',
      tripCreated: 'ટ્રિપ બની — પસંદ કરેલા PO ટ્રિપ વિભાગમાં ખસેડાયા.', correctedResubmitted: 'સુધારેલી ડિલિવરી ઓનરને ફરી મોકલાઈ.',
      deliveryUpdated: 'ડિલિવરી પૂર્ણ — જોડાયેલા PO ઓનર ટ્રેકરમાં અપડેટ થયા.', readingInvoice: 'ઇન્વૉઇસ વાંચી રહ્યું છે…',
      selectAtLeastOne: 'પહેલા ઓછામાં ઓછો એક PO પસંદ કરો.', waitForInvoice: 'PO {po}નું ઇન્વૉઇસ વાંચવાનું પૂરું થાય ત્યાં સુધી રાહ જુઓ.', replaceWrongInvoice: 'અપલોડ કરેલું ઇન્વૉઇસ PO {po} સાથે મળતું નથી. સાચું ઇન્વૉઇસ અપલોડ કરો.',
      uploadVerifyInvoice: 'PO {po}નું ઇન્વૉઇસ અપલોડ કરીને ચકાસો.', invoiceAmountRequired: 'PO {po} માટે ઇન્વૉઇસ રકમ દાખલ કરો અથવા ચકાસો.', selectTransporterError: 'ટ્રાન્સપોર્ટર માસ્ટરમાંથી ટ્રાન્સપોર્ટર પસંદ કરો.', editInvoiceFirst: 'ટ્રિપ સુધારી PO {po}ની ઇન્વૉઇસ વિગતો પૂર્ણ કરો.',
      planning: 'આયોજન', pending: 'બાકી', delivered: 'ડિલિવર થયેલ', cancelled: 'રદ થયેલ',
      invoiceCopyRequired: 'ટ્રિપ બનાવતા પહેલા ઇન્વૉઇસ નકલ જોડો.', invoiceTooLarge: 'ઇન્વૉઇસ નકલ 10 MB અથવા તેનાથી નાની હોવી જોઈએ.', slipRequired: 'ટ્રિપ પૂર્ણ કરતા પહેલા સહીવાળી ડિલિવરી સ્લિપ અપલોડ કરો.',
      slipTooLarge: 'ડિલિવરી સ્લિપ 10 MB અથવા તેનાથી નાની હોવી જોઈએ.', pdfReaderError: 'PDF રીડર લોડ થયો નથી. ઇન્ટરનેટ તપાસી ફરી પ્રયાસ કરો.', tripSetupNotReady: 'ટ્રિપ સેટઅપ તૈયાર નથી. એડમિનિસ્ટ્રેટરનો સંપર્ક કરો.',
      couldNotSaveTrip: 'ટ્રિપ સાચવી શકાઈ નથી.', couldNotComplete: 'ડિલિવરી પૂર્ણ થઈ શકી નથી.', signInFailed: 'સાઇન ઇન થઈ શક્યું નથી.', notConfigured: 'એપનું સેટઅપ પૂર્ણ નથી.', signInAgain: 'ફરી સાઇન ઇન કરો.',
      invoiceNumberPlaceholder: 'ઇન્વૉઇસ નંબર',
      imageInvoiceManual: 'મૂળ Tally ઇન્વૉઇસ PDF પસંદ કરો. ઇમેજ અથવા PO નકલ ઇન્વૉઇસ તરીકે વાંચી શકાતી નથી.', wrongInvoice: 'ખોટું ઇન્વૉઇસ: આ PO {actual}નું છે, {expected}નું નથી.',
      invoiceMatched: '✓ PO {po} મેળ ખાય છે', verifyInvoice: 'આ વાંચી શકાય તેવી Tally ઇન્વૉઇસ PDF નથી. મૂળ ઇન્વૉઇસ PDF પસંદ કરો.', savingChanges: 'ફેરફાર સાચવી રહ્યા છે…', creatingTrip: 'ટ્રિપ બની રહી છે…',
      createManualPo: '+ મેન્યુઅલ PO બનાવો', manualPoEyebrow: 'મેન્યુઅલ પરચેઝ ઓર્ડર', manualPoTitle: 'નવો PO બનાવો',
      manualPoHelp: 'નીચે POની વિગતો દાખલ કરો. તે મળેલ સ્થિતિમાં સાચવાશે અને તરત ઓપન PO યાદીમાં દેખાશે.',
      customerName: 'ગ્રાહકનું નામ*', customerPlaceholder: 'ઉદાહરણ: DMart', manualPoNumber: 'PO નંબર*', poNumberPlaceholder: 'PO નંબર દાખલ કરો',
      manualLocation: 'ડિલિવરી સ્થળ*', locationPlaceholder: 'ઉદાહરણ: Bopal', manualPoValue: 'PO મૂલ્ય (₹)', manualPoDate: 'PO તારીખ*',
      poReceivedDate: 'PO મળ્યાની તારીખ*', manualDeliveryDate: 'અપોઇન્ટમેન્ટ તારીખ', manualAssignedTo: 'જવાબદારી', assignedPlaceholder: 'સ્ટાફનું નામ અથવા ઈમેલ',
      poCopy: 'PO નકલ', poCopyHelp: 'વૈકલ્પિક PDF, JPG અથવા PNG, વધુમાં વધુ 10 MB.', remarks: 'નોંધ', remarksPlaceholder: 'કોઈ ખાસ ડિલિવરી સૂચના',
      savePo: 'PO સાચવો', savingPo: 'PO સાચવાઈ રહ્યો છે…', manualPoSaved: 'મેન્યુઅલ PO સાચવાયો અને ઓપન PO યાદીમાં ઉમેરાયો.',
      manualDuplicate: 'આ PO નંબર પહેલેથી હાજર છે.', manualFileTooLarge: 'PO નકલ 10 MB અથવા તેનાથી નાની હોવી જોઈએ.',
      manualFileType: 'PO નકલ PDF, JPG અથવા PNG ફાઇલ હોવી જોઈએ.', couldNotSavePo: 'PO સાચવી શકાયો નથી.',
      appointmentEyebrow: 'ડિલિવરી અપોઇન્ટમેન્ટ', appointmentTitle: 'અપોઇન્ટમેન્ટ તારીખ સુધારો', appointmentDate: 'અપોઇન્ટમેન્ટ તારીખ',
      appointmentHelp: 'DMart દ્વારા અપોઇન્ટમેન્ટ નક્કી ન થઈ હોય ત્યારે જ ખાલી રાખો.', appointmentForPo: 'PO {po} · {location}',
      editAppointment: 'તારીખ સુધારો', saveAppointment: 'અપોઇન્ટમેન્ટ સાચવો', savingAppointment: 'સાચવી રહ્યા છે…',
      appointmentSaved: 'અપોઇન્ટમેન્ટ તારીખ સુધારાઈ.', couldNotSaveAppointment: 'અપોઇન્ટમેન્ટ તારીખ સુધારી શકાયી નથી.'
    },
    hi: {
      brand: 'KSDL डिस्ट्रीब्यूशन', pageTitle: 'डिस्पैच और इनवॉइस जाँच', loginSubtitle: 'अकाउंटेंट और सेल्स प्रतिनिधि के लिए। अपने अधिकृत बिज़नेस ईमेल से साइन इन करें।',
      language: 'भाषा', email: 'ईमेल', password: 'पासवर्ड', signIn: 'साइन इन', refresh: 'रिफ्रेश', signOut: 'साइन आउट',
      totalOpenPos: 'कुल खुले PO', value: '{amount} मूल्य', received: 'प्राप्त', waitingPlanning: 'प्लानिंग बाकी', scheduled: 'निर्धारित', plannedDispatch: 'डिस्पैच की योजना बनी',
      inTransit: 'रास्ते में', materialOnRoad: 'सामान रास्ते में है', partiallyDelivered: 'आंशिक डिलीवरी', balancePending: 'बाकी माल देना है',
      searchPlaceholder: 'PO, ग्राहक, स्थान, इनवॉइस या ट्रांसपोर्टर खोजें', allOpenStatuses: 'सभी खुले स्टेटस', allDates: 'सभी तारीखें', currentMonth: 'चालू महीना',
      lastMonth: 'पिछला महीना', customDates: 'अपनी तारीखें', from: 'से', to: 'तक', clearFilters: 'फिल्टर हटाएँ', openPurchaseOrders: 'खुले परचेज़ ऑर्डर',
      poCustomer: 'PO / ग्राहक', poDate: 'PO तारीख', status: 'स्थिति', deliveryLocation: 'डिलीवरी स्थान', poValue: 'PO मूल्य', deliveryDate: 'अपॉइंटमेंट तारीख',
      invoice: 'इनवॉइस', transport: 'ट्रांसपोर्ट', assigned: 'जिम्मेदारी', age: 'आयु', noOpenPos: 'कोई खुला PO नहीं मिला', noOpenPosHelp: 'मौजूदा खोज और फिल्टर से मेल खाने वाला कोई PO नहीं है।',
      tripDate: 'ट्रिप तारीख*', transporterOwner: 'ट्रांसपोर्टर / टेम्पो मालिक*', selectTransporter: 'ट्रांसपोर्टर चुनें', vehicleNumber: 'वाहन नंबर', driverName: 'ड्राइवर का नाम',
      driverPhone: 'ड्राइवर फोन', vehicleCost: 'वाहन / टेम्पो खर्च (₹)', optional: 'वैकल्पिक', invoiceCostHeading: 'हर PO का इनवॉइस और डिलीवरी खर्च',
      invoiceCostHelp: 'हर Tally इनवॉइस PDF अपलोड करें। इनवॉइस नंबर और तारीख अपने आप भरेंगे और चुने गए PO से जाँच होगी।',
      poLocation: 'PO / स्थान', invoiceNumber: 'इनवॉइस नंबर*', invoiceDate: 'इनवॉइस तारीख*', invoiceAmount: 'इनवॉइस राशि (₹)', invoiceCopy: 'इनवॉइस कॉपी', allocatedCost: 'आवंटित खर्च (₹)', cancel: 'रद्द करें',
      deliveryCompleted: 'डिलीवरी पूरी', completeDelivery: 'डिलीवरी पूरी करें', finalTransportCost: 'अंतिम ट्रांसपोर्ट खर्च (₹)', signedDeliverySlip: 'हस्ताक्षरित डिलीवरी स्लिप*',
      finalTotalCost: 'कुल अंतिम ट्रांसपोर्ट खर्च', completionNote: 'सभी PO के खर्च से कुल अपने आप निकलेगा। हर PO की डिलीवरी स्लिप, अंतिम खर्च, इनवॉइस विवरण और कॉपी मालिक के ट्रैकर में जाएगी।',
      step4: 'चरण 4', posInTrip: 'ट्रिप में PO', reviewHint: 'सही दस्तावेज़ लगे हैं या नहीं, यह जाँचने के लिए PO और इनवॉइस कॉपी यहाँ खोलें।', tripDatePlain: 'ट्रिप तारीख',
      poLocationCopy: 'PO / स्थान / PO कॉपी', tempoDriver: 'टेम्पो / ड्राइवर', invoiceAndCopy: 'इनवॉइस / इनवॉइस कॉपी', tempoCost: 'टेम्पो खर्च', action: 'कार्रवाई',
      noPosInTrip: 'कोई PO ट्रिप में नहीं है', noPosInTripHelp: 'ऊपर PO चुनकर पहला डिलीवरी प्लान बनाएँ।', footerNote: 'इस पेज पर अकाउंटेंट दस्तावेज़ जाँच सकता है और सेल्स प्रतिनिधि ट्रिप बना और पूरी कर सकता है।',
      connecting: 'कनेक्ट हो रहा है…', loadingPos: 'PO लोड हो रहे हैं…', couldNotLoad: 'PO लोड नहीं हो सके', cloudSynced: 'क्लाउड सिंक हुआ', setupRequired: 'PO लोड हुए; भुगतान सेटअप जरूरी',
      openPoCount: '{count} खुले PO', activeTripCount: '{count} सक्रिय ट्रिप', createNewTripCount: 'नई ट्रिप बनाएँ ({count})', createTripCount: '{count} PO की ट्रिप बनाएँ',
      updateDeliveryPlan: 'डिलीवरी प्लान अपडेट करें', planDelivery: 'डिलीवरी की योजना', editTrip: 'ट्रिप संपादित करें', createNewTrip: 'नई ट्रिप बनाएँ',
      selectedPos: '{count} PO: {pos}', selectPosHelp: 'एक डिलीवरी ट्रिप बनाने के लिए ऊपर PO चुनें।', locationPending: 'स्थान बाकी', receivedOn: '{date} को प्राप्त', days: '{count} दिन',
      viewPoCopy: 'PO कॉपी देखें', viewInvoiceCopy: 'इनवॉइस कॉपी देखें', poCopyUnavailable: 'PO कॉपी उपलब्ध नहीं', invoiceCopyUnavailable: 'इनवॉइस कॉपी उपलब्ध नहीं',
      invoiceAttached: 'इनवॉइस पहले से जुड़ा है। बदलने के लिए ही नई फाइल अपलोड करें।', selectTally: 'अपने आप भरने के लिए Tally PDF चुनें।', ownerCorrection: 'मालिक का सुधार: {reason}',
      correctionRequested: 'सुधार माँगा गया', pleaseReview: 'इस डिलीवरी को फिर जाँचें।', noPosLinked: 'कोई PO जुड़ा नहीं', needsCorrection: 'सुधार जरूरी',
      edit: 'संपादित करें', deleteTrip: 'एंट्री हटाएँ', deleteTripConfirm: 'यह ट्रिप एंट्री हटाएँ? इसके PO फिर खुली सूची में आ जाएँगे ताकि ट्रिप दोबारा बनाई जा सके।', tripDeleted: 'ट्रिप एंट्री हटा दी गई। PO नई ट्रिप के लिए उपलब्ध हैं।', couldNotDeleteTrip: 'यह ट्रिप एंट्री हटाई नहीं जा सकी।',
      correctDelivery: 'डिलीवरी सुधारें', saveTripChanges: 'ट्रिप बदलाव सहेजें', completeEachDelivery: 'इस ट्रिप के {count} PO — हर डिलीवरी अलग से पूरी करें।',
      returnedByOwner: 'मालिक ने {count} PO वापस भेजे — सही डिलीवरी स्लिप और अंतिम खर्च अपलोड करें।', tripNotFound: 'ट्रिप नहीं मिली। रिफ्रेश करके फिर प्रयास करें।',
      uploadSlipForPo: 'PO {po} की हस्ताक्षरित डिलीवरी स्लिप अपलोड करें।', completingDelivery: 'डिलीवरी पूरी हो रही है…', tripChangesSaved: 'ट्रिप बदलाव सहेजे गए।',
      tripCreated: 'ट्रिप बनी — चुने गए PO ट्रिप सेक्शन में चले गए।', correctedResubmitted: 'सुधारी गई डिलीवरी मालिक को फिर भेजी गई।',
      deliveryUpdated: 'डिलीवरी पूरी — जुड़े PO मालिक के ट्रैकर में अपडेट हुए।', readingInvoice: 'इनवॉइस पढ़ा जा रहा है…',
      selectAtLeastOne: 'पहले कम से कम एक PO चुनें।', waitForInvoice: 'PO {po} का इनवॉइस पढ़ना पूरा होने तक रुकें।', replaceWrongInvoice: 'अपलोड किया गया इनवॉइस PO {po} से मेल नहीं खाता। सही इनवॉइस लगाएँ।',
      uploadVerifyInvoice: 'PO {po} का इनवॉइस अपलोड करके जाँचें।', invoiceAmountRequired: 'PO {po} की इनवॉइस राशि दर्ज करें या जाँचें।', selectTransporterError: 'ट्रांसपोर्टर मास्टर से ट्रांसपोर्टर चुनें।', editInvoiceFirst: 'ट्रिप संपादित करके PO {po} का इनवॉइस विवरण पूरा करें।',
      planning: 'योजना', pending: 'बाकी', delivered: 'डिलीवर हुआ', cancelled: 'रद्द',
      invoiceCopyRequired: 'ट्रिप बनाने से पहले इनवॉइस कॉपी लगाएँ।', invoiceTooLarge: 'इनवॉइस कॉपी 10 MB या उससे छोटी होनी चाहिए।', slipRequired: 'ट्रिप पूरी करने से पहले हस्ताक्षरित डिलीवरी स्लिप अपलोड करें।',
      slipTooLarge: 'डिलीवरी स्लिप 10 MB या उससे छोटी होनी चाहिए।', pdfReaderError: 'PDF रीडर लोड नहीं हुआ। इंटरनेट जाँचकर फिर प्रयास करें।', tripSetupNotReady: 'ट्रिप सेटअप तैयार नहीं है। एडमिनिस्ट्रेटर से संपर्क करें।',
      couldNotSaveTrip: 'ट्रिप सहेजी नहीं जा सकी।', couldNotComplete: 'डिलीवरी पूरी नहीं हो सकी।', signInFailed: 'साइन इन नहीं हुआ।', notConfigured: 'ऐप का सेटअप पूरा नहीं है।', signInAgain: 'फिर से साइन इन करें।',
      invoiceNumberPlaceholder: 'इनवॉइस नंबर',
      imageInvoiceManual: 'मूल Tally इनवॉइस PDF चुनें। इमेज या PO कॉपी को इनवॉइस के रूप में नहीं पढ़ा जा सकता।', wrongInvoice: 'गलत इनवॉइस: यह PO {actual} का है, {expected} का नहीं।',
      invoiceMatched: '✓ PO {po} मेल खाता है', verifyInvoice: 'यह पढ़ने योग्य Tally इनवॉइस PDF नहीं है। मूल इनवॉइस PDF चुनें।', savingChanges: 'बदलाव सहेजे जा रहे हैं…', creatingTrip: 'ट्रिप बन रही है…',
      createManualPo: '+ मैन्युअल PO बनाएँ', manualPoEyebrow: 'मैन्युअल परचेज़ ऑर्डर', manualPoTitle: 'नया PO बनाएँ',
      manualPoHelp: 'नीचे PO का विवरण भरें। यह प्राप्त स्थिति में सहेजा जाएगा और तुरंत खुले PO की सूची में दिखेगा।',
      customerName: 'ग्राहक का नाम*', customerPlaceholder: 'उदाहरण: DMart', manualPoNumber: 'PO नंबर*', poNumberPlaceholder: 'PO नंबर दर्ज करें',
      manualLocation: 'डिलीवरी स्थान*', locationPlaceholder: 'उदाहरण: Bopal', manualPoValue: 'PO मूल्य (₹)', manualPoDate: 'PO तारीख*',
      poReceivedDate: 'PO प्राप्ति तारीख*', manualDeliveryDate: 'अपॉइंटमेंट तारीख', manualAssignedTo: 'जिम्मेदारी', assignedPlaceholder: 'स्टाफ का नाम या ईमेल',
      poCopy: 'PO कॉपी', poCopyHelp: 'वैकल्पिक PDF, JPG या PNG, अधिकतम 10 MB.', remarks: 'टिप्पणी', remarksPlaceholder: 'कोई विशेष डिलीवरी निर्देश',
      savePo: 'PO सहेजें', savingPo: 'PO सहेजा जा रहा है…', manualPoSaved: 'मैन्युअल PO सहेजा गया और खुले PO की सूची में जुड़ गया।',
      manualDuplicate: 'यह PO नंबर पहले से मौजूद है।', manualFileTooLarge: 'PO कॉपी 10 MB या उससे छोटी होनी चाहिए।',
      manualFileType: 'PO कॉपी PDF, JPG या PNG फाइल होनी चाहिए।', couldNotSavePo: 'PO सहेजा नहीं जा सका।',
      appointmentEyebrow: 'डिलीवरी अपॉइंटमेंट', appointmentTitle: 'अपॉइंटमेंट तारीख बदलें', appointmentDate: 'अपॉइंटमेंट तारीख',
      appointmentHelp: 'DMart ने अपॉइंटमेंट तय न किया हो तभी इसे खाली रखें।', appointmentForPo: 'PO {po} · {location}',
      editAppointment: 'तारीख बदलें', saveAppointment: 'अपॉइंटमेंट सहेजें', savingAppointment: 'सहेज रहे हैं…',
      appointmentSaved: 'अपॉइंटमेंट तारीख अपडेट हो गई।', couldNotSaveAppointment: 'अपॉइंटमेंट तारीख अपडेट नहीं हो सकी।'
    }
  };
  const LOCALES = { en: 'en-IN', gu: 'gu-IN', hi: 'hi-IN' };
  let currentLanguage = localStorage.getItem(LANGUAGE_KEY) || 'en';
  if (!TRANSLATIONS[currentLanguage]) currentLanguage = 'en';
  const t = (key, values = {}) => {
    let text = TRANSLATIONS[currentLanguage]?.[key] || TRANSLATIONS.en[key] || key;
    Object.entries(values).forEach(([name, value]) => { text = text.replaceAll(`{${name}}`, value); });
    return text;
  };

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  let session = null;
  let refreshPromise = null;
  let records = [];
  let trips = [];
  let transporters = [];
  let selectedPoIds = new Set();
  let editingTripId = null;
  let completingTripId = null;
  let tripStorageReady = true;
  let refreshTimer = null;
  let connectionMessageKey = 'connecting';

  const $ = id => document.getElementById(id);
  const money = value => new Intl.NumberFormat(LOCALES[currentLanguage], { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const localDate = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString(LOCALES[currentLanguage], { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const isoDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const today = () => isoDate(new Date());
  const ageDays = record => record.po_received_date ? Math.max(0, Math.floor((new Date() - new Date(`${record.po_received_date}T00:00:00`)) / 86400000)) : null;
  const normalizeDeliveryLocation = value => {
    const location = String(value || '').replace(/\s+/g, ' ').trim();
    return /^modasa(?:\b|[,\-])/i.test(location) ? 'Modasa' : location;
  };

  function show(id) { $(id).classList.remove('hidden'); }
  function hide(id) { $(id).classList.add('hidden'); }
  function applyLanguage(nextLanguage = currentLanguage) {
    currentLanguage = TRANSLATIONS[nextLanguage] ? nextLanguage : 'en';
    localStorage.setItem(LANGUAGE_KEY, currentLanguage);
    document.documentElement.lang = currentLanguage;
    document.title = `KSDL ${t('pageTitle')}`;
    document.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = t(element.dataset.i18n); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(element => { element.placeholder = t(element.dataset.i18nPlaceholder); });
    if ($('languageSelect')) $('languageSelect').value = currentLanguage;
    if ($('loginLanguageSelect')) $('loginLanguageSelect').value = currentLanguage;
    if ($('connectionStatus')) $('connectionStatus').textContent = t(connectionMessageKey);
    renderTransporterOptions();
    render();
  }
  function setConnectionStatus(key) { connectionMessageKey = key; $('connectionStatus').textContent = t(key); }
  function headers(extra = {}) { return { apikey: PUBLIC_KEY, Authorization: `Bearer ${session?.access_token || PUBLIC_KEY}`, ...extra }; }
  function saveSession(nextSession) { session = nextSession; sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); }
  function tokenExpiresSoon() {
    if (!session?.access_token) return false;
    let expiresAt = Number(session.expires_at || 0);
    if (!expiresAt) { try { const payload = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); expiresAt = Number(JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))).exp || 0); } catch (_) { return false; } }
    return expiresAt * 1000 <= Date.now() + 60000;
  }
  async function refreshSession() {
    if (refreshPromise) return refreshPromise;
    if (!session?.refresh_token) throw new Error('Your session has expired. Please sign in again.');
    refreshPromise = (async () => {
      const response = await fetch(`${BASE_URL}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: PUBLIC_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }) });
      const text = await response.text(); let data = null; if (text) { try { data = JSON.parse(text); } catch (_) { data = text; } }
      if (!response.ok || !data?.access_token) throw new Error(data?.message || data?.error_description || 'Your session has expired. Please sign in again.');
      saveSession({ ...session, ...data }); return session;
    })();
    try { return await refreshPromise; } finally { refreshPromise = null; }
  }
  async function api(path, options = {}, allowRefreshRetry = true) {
    const tokenRequest = path.startsWith('/auth/v1/token');
    if (!tokenRequest && session?.refresh_token && tokenExpiresSoon()) await refreshSession();
    const requestHeaders = tokenRequest ? { apikey: PUBLIC_KEY, Authorization: `Bearer ${PUBLIC_KEY}`, ...(options.headers || {}) } : headers(options.headers || {});
    const response = await fetch(`${BASE_URL}${path}`, { ...options, headers: requestHeaders });
    const text = await response.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (_) { data = text; } }
    const message = data?.message || data?.error_description || text || `Request failed (${response.status})`;
    if (!response.ok && allowRefreshRetry && !tokenRequest && session?.refresh_token && (response.status === 401 || /exp(?:ired)?|jwt|timestamp check failed/i.test(String(message)))) { await refreshSession(); return api(path, options, false); }
    if (!response.ok) throw new Error(message);
    return data;
  }
  function toast(message) {
    const element = $('toast'); element.textContent = message; element.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove('show'), 3000);
  }
  async function signIn(email, password) {
    const data = await api('/auth/v1/token?grant_type=password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    saveSession(data);
  }
  async function signOut() {
    try { if (session?.access_token) await api('/auth/v1/logout', { method: 'POST' }); } catch (_) { /* local sign-out still succeeds */ }
    clearInterval(refreshTimer); session = null; sessionStorage.removeItem(SESSION_KEY); hide('app'); show('loginScreen');
  }

  function filePath(value) {
    const text = String(value || ''); const marker = `/storage/v1/object/public/${NOTE_BUCKET}/`;
    return text.includes(marker) ? text.split(marker)[1].split('?')[0] : text;
  }
  async function signedFileUrl(value) {
    const path = filePath(value); if (!path) return '';
    const data = await api(`/storage/v1/object/sign/${NOTE_BUCKET}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) });
    return data?.signedURL ? `${BASE_URL}/storage/v1${data.signedURL}` : '';
  }
  async function uploadTripInvoice(tripId, poId, file) {
    if (!file) throw new Error(t('invoiceCopyRequired'));
    if (file.size > 10 * 1024 * 1024) throw new Error(t('invoiceTooLarge'));
    const fileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `trip-invoices/${tripId}/${poId}/${Date.now()}-${fileName}`;
    await api(`/storage/v1/object/${NOTE_BUCKET}/${path}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'true' }, body: file });
    return path;
  }
  async function uploadTripDeliverySlip(tripId, poId, file) {
    if (!file) throw new Error(t('slipRequired'));
    if (file.size > 10 * 1024 * 1024) throw new Error(t('slipTooLarge'));
    const fileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `trip-delivery-slips/${tripId}/${poId}/${Date.now()}-${fileName}`;
    await api(`/storage/v1/object/${NOTE_BUCKET}/${path}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'true' }, body: file });
    return path;
  }
  async function uploadManualPoCopy(poId, file) {
    if (!file) return '';
    if (file.size > 10 * 1024 * 1024) throw new Error(t('manualFileTooLarge'));
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    const allowedExtension = /\.(pdf|jpe?g|png)$/i.test(file.name);
    if (!allowedTypes.includes(file.type) && !allowedExtension) throw new Error(t('manualFileType'));
    const fileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `manual-po-copies/${poId}/${Date.now()}-${fileName}`;
    await api(`/storage/v1/object/${NOTE_BUCKET}/${path}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'true' }, body: file });
    return path;
  }

  function closeManualPoDialog() {
    if ($('manualPoDialog').open) $('manualPoDialog').close();
    $('manualPoForm').reset();
    $('manualPoError').textContent = '';
  }
  function openManualPoDialog() {
    $('manualPoForm').reset();
    $('manualPoDate').value = today();
    $('manualReceivedDate').value = today();
    $('manualAssignedTo').value = session?.user?.email || '';
    $('manualPoError').textContent = '';
    $('manualPoDialog').showModal();
    window.setTimeout(() => $('manualCustomer').focus(), 0);
  }
  async function saveManualPo(event) {
    event.preventDefault();
    const error = $('manualPoError');
    const button = $('saveManualPoBtn');
    error.textContent = '';
    const poNumber = $('manualPoNumber').value.trim();
    const poId = crypto.randomUUID();
    try {
      button.disabled = true;
      button.textContent = t('savingPo');
      const duplicate = await api(`/rest/v1/purchase_orders?po_number=eq.${encodeURIComponent(poNumber)}&select=id&limit=1`);
      if (Array.isArray(duplicate) && duplicate.length) throw new Error(t('manualDuplicate'));
      const poCopyPath = await uploadManualPoCopy(poId, $('manualPoFile').files?.[0]);
      const now = new Date().toISOString();
      const payload = {
        id: poId,
        customer_name: $('manualCustomer').value.trim(),
        po_number: poNumber,
        po_date: $('manualPoDate').value,
        po_received_date: $('manualReceivedDate').value,
        delivery_date: $('manualDeliveryDate').value || null,
        delivery_location: normalizeDeliveryLocation($('manualLocation').value),
        po_value: Number($('manualPoValue').value || 0),
        assigned_to: $('manualAssignedTo').value.trim() || null,
        remarks: $('manualRemarks').value.trim() || null,
        po_attachment_url: poCopyPath || null,
        status: 'Received',
        created_by: session?.user?.id,
        entry_source: 'Manual',
        review_status: 'Draft',
        updated_at: now
      };
      await api('/rest/v1/purchase_orders', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(payload) });
      try {
        await api(`/rest/v1/purchase_orders?id=eq.${encodeURIComponent(poId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ review_status: 'Submitted', submitted_at: now, updated_at: now })
        });
      } catch (_) { /* Draft PO remains usable if review submission is unavailable. */ }
      closeManualPoDialog();
      await loadData();
      toast(t('manualPoSaved'));
    } catch (err) {
      error.textContent = err.message || t('couldNotSavePo');
    } finally {
      button.disabled = false;
      button.textContent = t('savePo');
    }
  }

  function closeAppointmentDialog() {
    if ($('appointmentDialog').open) $('appointmentDialog').close();
    $('appointmentForm').reset();
    $('appointmentPoId').value = '';
    $('appointmentError').textContent = '';
  }
  function openAppointmentDialog(poId) {
    const record = records.find(item => item.id === poId);
    if (!record) return;
    $('appointmentPoId').value = record.id;
    $('appointmentDate').value = record.delivery_date || '';
    $('appointmentSummary').textContent = t('appointmentForPo', {
      po: record.po_number || '—',
      location: record.delivery_location || t('locationPending')
    });
    $('appointmentError').textContent = '';
    $('appointmentDialog').showModal();
    window.setTimeout(() => $('appointmentDate').focus(), 0);
  }
  async function saveAppointmentDate(event) {
    event.preventDefault();
    const poId = $('appointmentPoId').value;
    const record = records.find(item => item.id === poId);
    if (!record) return;
    const button = $('saveAppointmentBtn');
    const error = $('appointmentError');
    const appointmentDate = $('appointmentDate').value || null;
    error.textContent = '';
    try {
      button.disabled = true;
      button.textContent = t('savingAppointment');
      await api('/rest/v1/rpc/update_po_appointment_date', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ po_id: poId, new_appointment_date: appointmentDate })
      });
      record.delivery_date = appointmentDate;
      closeAppointmentDialog();
      render();
      toast(t('appointmentSaved'));
    } catch (err) {
      error.textContent = err.message || t('couldNotSaveAppointment');
    } finally {
      button.disabled = false;
      button.textContent = t('saveAppointment');
    }
  }

  function normalizePoNumber(value) { return String(value || '').replace(/\D/g, ''); }
  function tallyDateToIso(value) {
    const match = String(value || '').match(/(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/](\d{2,4})/);
    if (!match) return '';
    const months = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
    const month = months[match[2].toLowerCase()];
    if (!month) return '';
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return `${year}-${String(month).padStart(2, '0')}-${String(Number(match[1])).padStart(2, '0')}`;
  }
  function nearbyValue(lines, labelPattern, valuePattern, lookAhead = 8) {
    const index = lines.findIndex(line => labelPattern.test(line));
    if (index < 0) return '';
    return lines.slice(index, index + lookAhead).join(' ').match(valuePattern)?.[1] || '';
  }
  async function readPdfLines(file) {
    if (!window.pdfjsLib) throw new Error(t('pdfReaderError'));
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const positioned = content.items
        .filter(item => String(item.str || '').trim())
        .map(item => ({ text: String(item.str).trim(), x: item.transform?.[4] || 0, y: item.transform?.[5] || 0 }));
      const rows = [];
      positioned.sort((a, b) => Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x).forEach(item => {
        let row = rows.find(candidate => Math.abs(candidate.y - item.y) <= 2);
        if (!row) { row = { y: item.y, items: [] }; rows.push(row); }
        row.items.push(item);
      });
      pages.push(rows.sort((a, b) => b.y - a.y).map(row => row.items.sort((a, b) => a.x - b.x).map(item => item.text).join(' ').replace(/\s+/g, ' ').trim()));
    }
    return pages.flat();
  }
  function canonicalInvoiceArticle(value) {
    let name = String(value || '').toUpperCase().replace(/\bMYS\.?\s*SANDAL\b/g, 'MYSORE SANDAL').replace(/^M\s*S\s+/g, 'MYSORE SANDAL ').replace(/\s+/g, ' ').trim();
    if (!/^MYSORE SANDAL\b/.test(name)) name = `MYSORE SANDAL ${name}`;
    return name;
  }
  function parseTallyInvoiceItems(lines) {
    const items = [];
    lines.forEach((line, index) => {
      const match = String(line || '').match(/^(\d+)\s+(.+?)\s+(\d{8})\s+(.+)$/);
      if (!match) return;
      const tail = match[4];
      const quantities = Array.from(tail.matchAll(/([\d,]+(?:\.\d+)?)\s+(PCS|NOS|EA|BOX|CTN|BTL)\b/gi));
      const cbs = tail.match(/(?<![\d.,])([\d,]+(?:\.\d+)?)\s*CBS\b/i);
      const amounts = tail.match(/\d[\d,]*\.\d{2}/g) || [];
      if (!quantities.length || !amounts.length || !cbs) return;
      const nextLine = String(lines[index + 1] || '').replace(/\s+/g, ' ').trim();
      const description = /(?:MYSORE|MYS\.?\s*SANDAL|SANDAL)/i.test(nextLine) && !/^DISCOUNT\b/i.test(nextLine) ? nextLine : '';
      const rawName = match[2].replace(/(?:₹|Rs\.?)\s*[\d,.]+\s*\/-?/gi, '').replace(/\s+/g, ' ').trim();
      const quantity = quantities[0], rate = quantities.length > 1 ? quantities[1] : null;
      items.push({ line_number: Number(match[1]), article_name: canonicalInvoiceArticle(description || rawName), article_description: description || rawName, hsn_sac: match[3], quantity: Number(quantity[1].replace(/,/g, '')), quantity_cbs: Number(cbs[1].replace(/,/g, '')), unit: quantity[2].toUpperCase(), rate: rate ? Number(rate[1].replace(/,/g, '')) : null, taxable_amount: Number(amounts[amounts.length - 1].replace(/,/g, '')) });
    });
    return items;
  }
  function parseTallyInvoice(lines, expectedPoNumber = '') {
    const flat = lines.join(' ').replace(/\s+/g, ' ');
    const invoiceNumber = flat.match(/\b(BMAG\/\d{2}-\d{2}\/\d{3,8})\b/i)?.[1] || flat.match(/\b([A-Z]{2,10}[A-Z0-9 -]*\/\d{2}-\d{2}\/\d{3,8})\b/i)?.[1]?.replace(/\s+/g, ' ') || '';
    let invoiceDate = '';
    const invoiceLineIndex = lines.findIndex(line => invoiceNumber && line.includes(invoiceNumber));
    if (invoiceLineIndex >= 0) invoiceDate = lines.slice(invoiceLineIndex, invoiceLineIndex + 6).join(' ').match(/\b(\d{1,2}[-\s/][A-Za-z]{3,9}[-\s/]\d{2,4})\b/)?.[1] || '';
    if (!invoiceDate) invoiceDate = nearbyValue(lines, /\bDated\b/i, /\b(\d{1,2}[-\s/][A-Za-z]{3,9}[-\s/]\d{2,4})\b/, 5);
    const expectedPo = normalizePoNumber(expectedPoNumber);
    const expectedPoPattern = expectedPo ? new RegExp(`(?:^|\\D)${expectedPo}(?:\\D|$)`) : null;
    const poNumber = expectedPoPattern?.test(flat)
      ? expectedPoNumber
      : nearbyValue(lines, /Buyer'?s\s+Order\s+No/i, /\b(\d{8,12})\b/, 10);
    let destination = nearbyValue(lines, /\bDestination\b/i, /\bDestination\b\s*[:\-]?\s*([A-Za-z][A-Za-z .'-]{1,45})/i, 3).trim();
    destination = destination.replace(/\s+(Terms|Dispatch|Dated|Buyer|Mode|Other)\b.*$/i, '').trim();
    const amountWordsIndex = lines.findIndex(line => /Amount\s+Chargeable/i.test(line));
    const invoiceAmountBlock = amountWordsIndex > 0 ? lines.slice(Math.max(0, amountWordsIndex - 5), amountWordsIndex).join(' ') : '';
    const ewayInvoiceAmount = flat.match(/Total\s+Inv\s+Amt\s*:\s*([\d,]+\.\d{2})/i)?.[1] || '';
    const tallyTotalIndex = lines.findIndex(line => /^\s*Total\b/i.test(line) && /\b(?:PCS|CBS|NOS|EA|BOX|CTN)\b/i.test(line));
    const tallyTotalBlock = tallyTotalIndex >= 0 ? lines.slice(tallyTotalIndex, tallyTotalIndex + 3).join(' ') : '';
    const tallyTotalLine = lines.find(line => /\bTotal\b/i.test(line) && /(?:₹|Rs\.?)/i.test(line) && /\d[\d,]*\.\d{2}/.test(line)) || '';
    const tallyTotalAmount = tallyTotalBlock.match(/(?:₹|Rs\.?)\s*([\d,]+\.\d{2})/i)?.[1]
      || tallyTotalLine.match(/(?:₹|Rs\.?)\s*([\d,]+\.\d{2})(?!.*\d[\d,]*\.\d{2})/i)?.[1]
      || flat.match(/\bTotal\s+\d+(?:\.\d+)?\s+[A-Z]{2,8}\s+\d+(?:\.\d+)?\s+[A-Z]{2,8}\s+(?:₹|Rs\.?)?\s*([\d,]+\.\d{2})/i)?.[1]
      || '';
    const invoiceAmounts = invoiceAmountBlock.match(/\d[\d,]*\.\d{2}/g) || [];
    const invoiceValue = tallyTotalAmount
      ? Number(tallyTotalAmount.replace(/,/g, ''))
      : ewayInvoiceAmount
        ? Number(ewayInvoiceAmount.replace(/,/g, ''))
        : invoiceAmounts.length
          ? Math.max(...invoiceAmounts.map(value => Number(value.replace(/,/g, ''))))
          : null;
    const ewayBill = flat.match(/(?:e-?Way\s+Bill(?:\s+No\.?)?)[^0-9]{0,30}(\d{12})/i)?.[1] || '';
    const vehicleNumber = flat.match(/\b([A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{4})\b/i)?.[1]?.replace(/\s+/g, '').toUpperCase() || '';
    return { invoiceNumber, invoiceDate: tallyDateToIso(invoiceDate), poNumber, destination, invoiceValue, ewayBill, vehicleNumber, items: parseTallyInvoiceItems(lines) };
  }
  function invoiceStatus(row, state, message) {
    row.dataset.invoiceState = state;
    row.classList.toggle('invoice-mismatch', state === 'mismatch');
    row.classList.toggle('invoice-matched', state === 'matched');
    const status = row.querySelector('.invoice-read-status');
    status.dataset.state = state; status.textContent = message;
  }
  async function handleInvoiceFile(input) {
    const row = input.closest('tr'), file = input.files?.[0], record = records.find(item => item.id === row?.dataset.poId);
    if (!row || !record || !file) { if (row) invoiceStatus(row, 'idle', t('selectTally')); return; }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      invoiceStatus(row, 'warning', t('imageInvoiceManual')); return;
    }
    invoiceStatus(row, 'reading', t('readingInvoice'));
    try {
      const parsed = parseTallyInvoice(await readPdfLines(file), record.po_number);
      if (parsed.invoiceNumber) row.querySelector('.po-invoice-number').value = parsed.invoiceNumber;
      if (parsed.invoiceDate) row.querySelector('.po-invoice-date').value = parsed.invoiceDate;
      if (parsed.invoiceValue != null) row.querySelector('.po-invoice-amount').value = parsed.invoiceValue.toFixed(2);
      if (parsed.vehicleNumber) $('tripVehicle').value = parsed.vehicleNumber;
      row.dataset.invoiceItems = JSON.stringify(parsed.items || []);
      row.dataset.invoiceDestination = parsed.destination || record.delivery_location || '';
      const expectedPo = normalizePoNumber(record.po_number), invoicePo = normalizePoNumber(parsed.poNumber);
      const details = [parsed.invoiceNumber, record.delivery_location || parsed.destination, parsed.invoiceValue != null ? money(parsed.invoiceValue) : '', parsed.ewayBill ? `e-Way ${parsed.ewayBill}` : ''].filter(Boolean).join(' · ');
      if (invoicePo && expectedPo && invoicePo !== expectedPo) {
        invoiceStatus(row, 'mismatch', t('wrongInvoice', { actual: parsed.poNumber, expected: record.po_number })); return;
      }
      if (invoicePo && expectedPo === invoicePo && parsed.invoiceNumber && parsed.invoiceDate) {
        invoiceStatus(row, 'matched', `${t('invoiceMatched', { po: record.po_number })}${details ? ` · ${details}` : ''}`); return;
      }
      invoiceStatus(row, 'warning', t('verifyInvoice'));
    } catch (error) { invoiceStatus(row, 'warning', error.message || t('verifyInvoice')); }
  }

  async function loadData() {
    setConnectionStatus('loadingPos');
    const [poResult, tripResult, transporterResult] = await Promise.allSettled([
      api('/rest/v1/purchase_orders?is_archived=eq.false&select=*&order=po_received_date.desc'),
      api('/rest/v1/delivery_trips?select=*,delivery_trip_pos(purchase_order_id,allocated_cost,invoice_number,invoice_date,invoice_amount,invoice_attachment_url,delivery_status,correction_reason,purchase_orders(id,po_number,customer_name,delivery_location,status,po_attachment_url,invoice_number,invoice_date,invoice_amount,invoice_attachment_url))&order=trip_date.desc,created_at.desc'),
      api('/rest/v1/transporters?select=id,name,phone,active&active=eq.true&order=name.asc')
    ]);
    if (poResult.status === 'rejected') {
      records = []; trips = []; render(); setConnectionStatus('couldNotLoad'); toast(poResult.reason?.message || t('couldNotLoad')); return;
    }
    records = (Array.isArray(poResult.value) ? poResult.value : [])
      .map(record => ({ ...record, delivery_location: normalizeDeliveryLocation(record.delivery_location) }))
      .filter(record => OPEN_STATUSES.includes(record.status));
    tripStorageReady = tripResult.status === 'fulfilled';
    trips = tripStorageReady && Array.isArray(tripResult.value) ? tripResult.value
      .map(trip => ({
        ...trip,
        delivery_trip_pos: (trip.delivery_trip_pos || []).map(link => ({
          ...link,
          purchase_orders: link.purchase_orders ? {
            ...link.purchase_orders,
            delivery_location: normalizeDeliveryLocation(link.purchase_orders.delivery_location)
          } : link.purchase_orders
        }))
      }))
      .filter(trip => !CLOSED_TRIP_STATUSES.includes(trip.status) || (trip.delivery_trip_pos || []).some(link => link.delivery_status === 'Needs Correction')) : [];
    transporters = transporterResult.status === 'fulfilled' && Array.isArray(transporterResult.value) ? transporterResult.value : [];
    renderTransporterOptions();
    await Promise.all(records.map(async record => {
      if (record.po_attachment_url) record.po_attachment_link = await signedFileUrl(record.po_attachment_url).catch(() => '');
    }));
    await Promise.all(trips.flatMap(trip => (trip.delivery_trip_pos || []).map(async link => {
      const poCopy = link.purchase_orders?.po_attachment_url;
      const invoiceCopy = link.invoice_attachment_url || trip.invoice_attachment_url || link.purchase_orders?.invoice_attachment_url;
      if (poCopy) link.po_attachment_link = await signedFileUrl(poCopy).catch(() => '');
      if (invoiceCopy) link.invoice_attachment_link = await signedFileUrl(invoiceCopy).catch(() => '');
    })));
    const availableIds = new Set(availableRecords().map(record => record.id));
    selectedPoIds = new Set([...selectedPoIds].filter(id => availableIds.has(id)));
    setConnectionStatus(tripStorageReady && transporterResult.status === 'fulfilled' ? 'cloudSynced' : 'setupRequired');
    render();
  }

  function renderTransporterOptions(selectedId = '') {
    const select = $('tripTransporter'), current = selectedId || select.value;
    select.innerHTML = `<option value="">${safe(t('selectTransporter'))}</option>` + transporters.map(transporter => `<option value="${transporter.id}">${safe(transporter.name)}</option>`).join('');
    select.value = current;
  }

  function linkedPoIds() {
    return new Set(trips.flatMap(trip => (trip.delivery_trip_pos || []).map(link => link.purchase_order_id)));
  }
  function availableRecords() {
    const linked = linkedPoIds();
    return records.filter(record => !linked.has(record.id));
  }
  function monthBounds(offset) {
    const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = offset === 0 ? now : new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
    return { from: isoDate(start), to: isoDate(end) };
  }
  function selectedBounds() {
    const range = $('dateRangeFilter').value;
    if (range === 'current') return monthBounds(0); if (range === 'last') return monthBounds(-1);
    if (range === 'custom') return { from: $('dateFrom').value, to: $('dateTo').value };
    return { from: '', to: '' };
  }
  function recordMatchesFilters(record) {
    const search = $('searchInput').value.trim().toLowerCase(), status = $('statusFilter').value, { from, to } = selectedBounds();
    const poDate = record.po_date || '';
    const searchable = [record.po_number, record.customer_name, record.delivery_location, record.invoice_number, record.transporter, record.tracking_number, record.assigned_to].join(' ').toLowerCase();
    return (!status || record.status === status) && (!from || (poDate && poDate >= from)) && (!to || (poDate && poDate <= to)) && (!search || searchable.includes(search));
  }
  function filteredRecords() {
    return availableRecords().filter(recordMatchesFilters);
  }
  function filteredOpenRecords() {
    return records.filter(recordMatchesFilters);
  }
  function statusClass(status) { return String(status || '').toLowerCase().replaceAll(' ', '-'); }
  function statusLabel(status) {
    return ({ Received: t('received'), Scheduled: t('scheduled'), 'In Transit': t('inTransit'), Dispatched: t('inTransit'), 'Partially Delivered': t('partiallyDelivered'), 'Needs Correction': t('needsCorrection'), Pending: t('pending'), Delivered: t('delivered'), Cancelled: t('cancelled') })[status] || status || '—';
  }

  function renderOpenPos() {
    const showing = filteredRecords();
    const allOpen = filteredOpenRecords();
    const totalValue = allOpen.reduce((sum, record) => sum + Number(record.po_value || 0), 0);
    $('openCount').textContent = allOpen.length; $('openValue').textContent = t('value', { amount: money(totalValue) });
    $('receivedCount').textContent = allOpen.filter(record => record.status === 'Received').length;
    $('scheduledCount').textContent = allOpen.filter(record => record.status === 'Scheduled').length;
    $('transitCount').textContent = allOpen.filter(record => record.status === 'In Transit').length;
    $('partialCount').textContent = allOpen.filter(record => record.status === 'Partially Delivered').length;
    $('resultCount').textContent = t('openPoCount', { count: showing.length });
    $('poTableBody').innerHTML = showing.map(record => {
      const age = ageDays(record), attachment = record.po_attachment_link ? `<a class="po-link" href="${safe(record.po_attachment_link)}" target="_blank" rel="noopener">${safe(t('viewPoCopy'))}</a>` : '';
      return `<tr class="${selectedPoIds.has(record.id) ? 'selected-row' : ''}">
        <td class="selection-cell"><input class="po-choice" type="checkbox" value="${record.id}" ${selectedPoIds.has(record.id) ? 'checked' : ''} aria-label="Select ${safe(record.po_number)}" /></td>
        <td><span class="po-main">${safe(record.po_number || '—')}</span><span class="po-secondary">${safe(record.customer_name || '—')}</span>${attachment}</td>
        <td>${localDate(record.po_date)}<span class="po-secondary">${safe(t('receivedOn', { date: localDate(record.po_received_date) }))}</span></td>
        <td><span class="executive-status ${statusClass(record.status)}">${safe(statusLabel(record.status))}</span></td>
        <td>${safe(record.delivery_location || '—')}</td><td>${money(record.po_value)}</td><td><div class="appointment-cell"><span>${localDate(record.delivery_date)}</span><button class="text-btn appointment-edit-btn" type="button" data-po-id="${record.id}">${safe(t('editAppointment'))}</button></div></td>
        <td>${safe(record.invoice_number || '—')}<span class="po-secondary">${localDate(record.invoice_date)}</span></td>
        <td>${safe(record.transporter || '—')}<span class="po-secondary">${safe(record.tracking_number || '')}${record.transport_amount ? ` · ${money(record.transport_amount)}` : ''}</span></td>
        <td>${safe(record.assigned_to || '—')}</td><td>${age == null ? '—' : safe(t('days', { count: age }))}</td>
      </tr>`;
    }).join('');
    $('emptyState').classList.toggle('hidden', showing.length !== 0);
    const visibleIds = showing.map(record => record.id), selectedVisible = visibleIds.filter(id => selectedPoIds.has(id));
    $('selectAllPos').checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
    $('selectAllPos').indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
  }
  function renderPlan() {
    const editTrip = editingTripId ? trips.find(trip => trip.id === editingTripId) : null;
    const editLinks = editTrip?.delivery_trip_pos || [];
    const editLinksByPo = new Map(editLinks.map(link => [link.purchase_order_id, link]));
    const chosen = editTrip
      ? editLinks.map(link => records.find(record => record.id === link.purchase_order_id)).filter(Boolean)
      : records.filter(record => selectedPoIds.has(record.id));
    $('tripDialogEyebrow').textContent = editTrip ? t('updateDeliveryPlan') : t('planDelivery');
    $('tripDialogTitle').textContent = editTrip ? t('editTrip') : t('createNewTrip');
    $('selectedPoSummary').textContent = chosen.length ? t('selectedPos', { count: chosen.length, pos: chosen.map(record => record.po_number).join(', ') }) : t('selectPosHelp');
    $('tripPoDetails').innerHTML = chosen.map(record => {
      const link = editLinksByPo.get(record.id); const hasInvoice = Boolean(link?.invoice_attachment_url || record.invoice_attachment_url);
      const invoiceStatusText = hasInvoice ? t('invoiceAttached') : t('selectTally');
      const correction = link?.delivery_status === 'Needs Correction' ? `<span class="correction-note">${safe(t('ownerCorrection', { reason: link.correction_reason || t('pleaseReview') }))}</span>` : '';
      return `<tr data-po-id="${record.id}" data-invoice-state="${hasInvoice ? 'existing' : 'idle'}" data-existing-invoice="${safe(link?.invoice_attachment_url || record.invoice_attachment_url || '')}">
      <td><span class="po-main">${safe(record.po_number)}</span><span class="po-secondary">${safe(record.delivery_location || t('locationPending'))}</span>${correction}</td>
      <td><input class="po-invoice-number" required placeholder="${safe(t('invoiceNumberPlaceholder'))}" value="${safe(link?.invoice_number || record.invoice_number || '')}" /></td>
      <td><input class="po-invoice-date" type="date" required value="${safe(link?.invoice_date || record.invoice_date || '')}" /></td>
      <td><input class="po-invoice-amount" type="number" min="0.01" step="0.01" required placeholder="Required" value="${link?.invoice_amount ?? record.invoice_amount ?? ''}" /></td>
      <td><input class="po-invoice-file" type="file" accept="application/pdf,image/*" ${hasInvoice ? '' : 'required'} /><small class="invoice-read-status" data-state="${hasInvoice ? 'matched' : 'idle'}">${invoiceStatusText}</small></td>
      <td><input class="po-allocated-cost" type="number" min="0" step="0.01" placeholder="Optional" value="${link?.allocated_cost ?? ''}" /></td>
    </tr>`;
    }).join('');
    const selectedCount = records.filter(record => selectedPoIds.has(record.id)).length;
    $('openTripDialogBtn').disabled = selectedCount === 0;
    $('openTripDialogBtn').textContent = t('createNewTripCount', { count: selectedCount });
    $('createTripBtn').disabled = chosen.length === 0;
    $('createTripBtn').textContent = editTrip ? t('saveTripChanges') : t('createTripCount', { count: chosen.length });
  }
  function renderTrips() {
    $('tripCount').textContent = t('activeTripCount', { count: trips.length });
    $('inTripBody').innerHTML = trips.map(trip => {
      const links = trip.delivery_trip_pos || [];
      const correctionLinks = links.filter(link => link.delivery_status === 'Needs Correction'), needsCorrection = correctionLinks.length > 0;
      const chips = links.map(link => {
        const poCopy = link.po_attachment_link
          ? `<a class="trip-doc-link po-copy-link" href="${safe(link.po_attachment_link)}" target="_blank" rel="noopener">${safe(t('viewPoCopy'))}</a>`
          : `<span class="trip-doc-missing">${safe(t('poCopyUnavailable'))}</span>`;
        return `<div class="trip-po-card"><span class="trip-po-chip ${link.delivery_status === 'Needs Correction' ? 'needs-correction' : ''}">${safe(link.purchase_orders?.po_number || 'PO')} · ${safe(link.purchase_orders?.delivery_location || t('locationPending'))}${link.delivery_status === 'Needs Correction' ? `<small>${safe(link.correction_reason || t('correctionRequested'))}</small>` : ''}</span>${poCopy}</div>`;
      }).join('');
      const invoices = links.map(link => {
        const invoiceCopy = link.invoice_attachment_link
          ? `<a class="trip-doc-link invoice-copy-link" href="${safe(link.invoice_attachment_link)}" target="_blank" rel="noopener">${safe(t('viewInvoiceCopy'))}</a>`
          : `<span class="trip-doc-missing">${safe(t('invoiceCopyUnavailable'))}</span>`;
        const invoiceNumber = link.invoice_number || trip.invoice_number || link.purchase_orders?.invoice_number;
        const invoiceAmount = link.invoice_amount ?? link.purchase_orders?.invoice_amount;
        return `<div class="trip-invoice-row"><div><strong>${safe(link.purchase_orders?.po_number || 'PO')}:</strong> ${safe(invoiceNumber || '—')} · Invoice ${invoiceAmount == null ? '—' : money(invoiceAmount)} · Delivery ${money(link.allocated_cost)}</div>${invoiceCopy}</div>`;
      }).join('');
      const tempoCost = Number(trip.actual_freight || 0);
      return `<tr class="${needsCorrection ? 'correction-trip' : ''}"><td>${localDate(trip.trip_date)}</td><td><div class="trip-po-list">${chips || safe(t('noPosLinked'))}</div></td><td>${safe(trip.vehicle_number || trip.transporter || '—')}<span class="po-secondary">${safe(trip.driver_name || '')}</span></td><td>${invoices || '—'}</td><td><span class="executive-status ${needsCorrection ? 'needs-correction' : statusClass(trip.status)}">${safe(needsCorrection ? t('needsCorrection') : statusLabel(trip.status))}</span></td><td>${tempoCost ? money(tempoCost) : '—'}</td><td><div class="trip-actions"><button class="text-btn edit-trip-btn" type="button" data-trip-id="${trip.id}">${safe(t('edit'))}</button><button class="complete-trip-btn" type="button" data-trip-id="${trip.id}">${safe(needsCorrection ? t('correctDelivery') : t('completeDelivery'))}</button><button class="text-btn danger delete-trip-btn" type="button" data-trip-id="${trip.id}">${safe(t('deleteTrip'))}</button></div></td></tr>`;
    }).join('');
    $('tripEmptyState').classList.toggle('hidden', trips.length !== 0);
  }
  function render() { renderOpenPos(); if (!$('tripPlanDialog').open) renderPlan(); renderTrips(); }

  function closeTripDialog() {
    if ($('tripPlanDialog').open) $('tripPlanDialog').close();
    editingTripId = null; $('tripPlanForm').reset(); $('tripDate').value = today(); $('tripPlanError').textContent = ''; renderPlan();
  }
  function openCreateTrip() {
    if (!selectedPoIds.size) return;
    editingTripId = null; $('tripPlanForm').reset(); renderTransporterOptions(); $('tripDate').value = today(); $('tripPlanError').textContent = ''; renderPlan(); $('tripPlanDialog').showModal();
  }
  function openEditTrip(tripId) {
    const trip = trips.find(item => item.id === tripId); if (!trip) return;
    editingTripId = tripId; $('tripPlanForm').reset(); renderTransporterOptions(trip.transporter_id || '');
    $('tripDate').value = trip.trip_date || today(); $('tripVehicle').value = trip.vehicle_number || '';
    $('tripDriver').value = trip.driver_name || ''; $('tripDriverPhone').value = trip.driver_phone || ''; $('tripFreight').value = Number(trip.actual_freight || 0) || '';
    $('tripPlanError').textContent = ''; renderPlan(); $('tripPlanDialog').showModal();
  }
  async function saveTrip(event) {
    event.preventDefault(); const error = $('tripPlanError'); error.textContent = '';
    const editTrip = editingTripId ? trips.find(trip => trip.id === editingTripId) : null;
    const editLinks = editTrip?.delivery_trip_pos || [];
    const chosen = editTrip ? editLinks.map(link => records.find(record => record.id === link.purchase_order_id)).filter(Boolean) : records.filter(record => selectedPoIds.has(record.id));
    if (!chosen.length) { error.textContent = t('selectAtLeastOne'); return; }
    if (!tripStorageReady) { error.textContent = t('tripSetupNotReady'); return; }
    const button = $('createTripBtn');
    try {
      button.disabled = true; button.textContent = editTrip ? t('savingChanges') : t('creatingTrip');
      const freight = Number($('tripFreight').value || 0), tripId = editTrip?.id || crypto.randomUUID();
      const details = chosen.map(record => {
        const row = $('tripPoDetails').querySelector(`tr[data-po-id="${record.id}"]`);
        const invoiceAmountText = row.querySelector('.po-invoice-amount').value;
        let invoiceItems = [];
        try { invoiceItems = JSON.parse(row.dataset.invoiceItems || '[]'); } catch (_) { invoiceItems = []; }
        return { record, invoiceState: row.dataset.invoiceState || 'idle', existingInvoicePath: row.dataset.existingInvoice || '', invoiceNumber: row.querySelector('.po-invoice-number').value.trim(), invoiceDate: row.querySelector('.po-invoice-date').value, invoiceAmount: invoiceAmountText === '' ? null : Number(invoiceAmountText), invoiceFile: row.querySelector('.po-invoice-file').files[0], allocatedCost: Number(row.querySelector('.po-allocated-cost').value || 0), invoiceItems, invoiceDestination: normalizeDeliveryLocation(row.dataset.invoiceDestination || record.delivery_location || '') };
      });
      for (const detail of details) if (detail.invoiceState === 'reading') throw new Error(t('waitForInvoice', { po: detail.record.po_number }));
      for (const detail of details) if (detail.invoiceState === 'mismatch') throw new Error(t('replaceWrongInvoice', { po: detail.record.po_number }));
      for (const detail of details) if (!detail.invoiceNumber || !detail.invoiceDate || (!detail.invoiceFile && !detail.existingInvoicePath)) throw new Error(t('uploadVerifyInvoice', { po: detail.record.po_number }));
      for (const detail of details) if (detail.invoiceAmount == null || !Number.isFinite(detail.invoiceAmount) || detail.invoiceAmount <= 0) throw new Error(t('invoiceAmountRequired', { po: detail.record.po_number }));
      await Promise.all(details.map(async detail => { detail.invoicePath = detail.invoiceFile ? await uploadTripInvoice(tripId, detail.record.id, detail.invoiceFile) : detail.existingInvoicePath; }));
      const transporterId = $('tripTransporter').value, transporterName = $('tripTransporter').selectedOptions[0]?.textContent?.trim() || '';
      if (!transporterId) throw new Error(t('selectTransporterError'));
      const tripPayload = { trip_date: $('tripDate').value, transporter_id: transporterId, transporter: transporterName, vehicle_number: $('tripVehicle').value.trim() || null, driver_name: $('tripDriver').value.trim() || null, driver_phone: $('tripDriverPhone').value.trim() || null, quoted_cost: freight, actual_freight: freight };
      if (editTrip) {
        await api(`/rest/v1/delivery_trips?id=eq.${encodeURIComponent(tripId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(tripPayload) });
        await Promise.all(details.map(detail => api(`/rest/v1/delivery_trip_pos?trip_id=eq.${encodeURIComponent(tripId)}&purchase_order_id=eq.${encodeURIComponent(detail.record.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ allocation_method: 'Manual', allocated_cost: detail.allocatedCost, invoice_number: detail.invoiceNumber, invoice_date: detail.invoiceDate, invoice_amount: detail.invoiceAmount, invoice_attachment_url: detail.invoicePath }) })));
      } else {
        await api('/rest/v1/delivery_trips', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ id: tripId, status: 'Dispatched', ...tripPayload }) });
        const links = details.map(detail => ({ trip_id: tripId, purchase_order_id: detail.record.id, allocation_method: 'Manual', allocated_cost: detail.allocatedCost, invoice_number: detail.invoiceNumber, invoice_date: detail.invoiceDate, invoice_amount: detail.invoiceAmount, invoice_attachment_url: detail.invoicePath, delivery_status: 'Pending' }));
        await api('/rest/v1/delivery_trip_pos', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(links) });
        selectedPoIds.clear();
      }
      await Promise.all(details.filter(detail => detail.invoiceItems.length).map(detail => api('/rest/v1/rpc/import_dmart_invoice_items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: { invoice_number: detail.invoiceNumber, po_number: detail.record.po_number, invoice_date: detail.invoiceDate, delivery_location: normalizeDeliveryLocation(detail.invoiceDestination || detail.record.delivery_location) || null, items: detail.invoiceItems } }) }).catch(error => { console.warn(`Product movement import skipped for ${detail.invoiceNumber}: ${error.message}`); return null; })));
      closeTripDialog(); await loadData(); toast(editTrip ? t('tripChangesSaved') : t('tripCreated'));
    } catch (err) { error.textContent = err.message || t('couldNotSaveTrip'); }
    finally { button.disabled = false; button.textContent = editTrip ? t('saveTripChanges') : t('createTripCount', { count: chosen.length }); }
  }

  function closeCompleteTripDialog() {
    if ($('completeTripDialog').open) $('completeTripDialog').close();
    completingTripId = null; $('completeTripForm').reset(); $('completeTripError').textContent = '';
  }
  function updateCompleteTripTotal() {
    const total = [...document.querySelectorAll('.complete-po-cost')].reduce((sum, input) => sum + Number(input.value || 0), 0);
    $('completeTripTotal').textContent = money(total); return total;
  }
  function openCompleteTrip(tripId) {
    const trip = trips.find(item => item.id === tripId); if (!trip) return;
    const correctionLinks = (trip.delivery_trip_pos || []).filter(link => link.delivery_status === 'Needs Correction');
    const links = correctionLinks.length ? correctionLinks : (trip.delivery_trip_pos || []);
    const incompleteInvoice = links.find(link =>
      !(link.invoice_number || trip.invoice_number || link.purchase_orders?.invoice_number)
      || !(link.invoice_date || trip.invoice_date || link.purchase_orders?.invoice_date)
      || Number(link.invoice_amount ?? link.purchase_orders?.invoice_amount ?? 0) <= 0
      || !(link.invoice_attachment_url || trip.invoice_attachment_url || link.purchase_orders?.invoice_attachment_url)
    );
    if (incompleteInvoice) { toast(t('editInvoiceFirst', { po: incompleteInvoice.purchase_orders?.po_number || '' })); return; }
    completingTripId = tripId; $('completeTripForm').reset(); $('completeTripError').textContent = '';
    $('completeTripSummary').textContent = correctionLinks.length ? t('returnedByOwner', { count: links.length }) : t('completeEachDelivery', { count: links.length });
    $('completeTripPoDetails').innerHTML = links.map(link => `<tr data-po-id="${link.purchase_order_id}">
      <td><span class="po-main">${safe(link.purchase_orders?.po_number || 'PO')}</span><span class="po-secondary">${safe(link.purchase_orders?.delivery_location || t('locationPending'))}</span>${link.delivery_status === 'Needs Correction' ? `<span class="correction-note">${safe(t('ownerCorrection', { reason: link.correction_reason || t('pleaseReview') }))}</span>` : ''}</td>
      <td><input class="complete-po-cost" type="number" min="0" step="0.01" placeholder="0" value="${Number(link.allocated_cost || 0) || ''}" /></td>
      <td><input class="complete-po-slip" type="file" accept="application/pdf,image/jpeg,image/png" required /></td>
    </tr>`).join('');
    updateCompleteTripTotal();
    $('completeTripDialog').showModal();
  }
  async function completeTrip(event) {
    event.preventDefault(); const error = $('completeTripError'); error.textContent = '';
    const trip = trips.find(item => item.id === completingTripId);
    if (!trip) { error.textContent = t('tripNotFound'); return; }
    const details = [...$('completeTripPoDetails').querySelectorAll('tr')].map(row => ({ poId: row.dataset.poId, finalCost: Number(row.querySelector('.complete-po-cost').value || 0), slip: row.querySelector('.complete-po-slip').files?.[0], poNumber: row.querySelector('.po-main')?.textContent || 'PO' }));
    const missingSlip = details.find(detail => !detail.slip); if (missingSlip) { error.textContent = t('uploadSlipForPo', { po: missingSlip.poNumber }); return; }
    const button = $('completeTripBtn');
    try {
      button.disabled = true; button.textContent = t('completingDelivery');
      const deliveries = await Promise.all(details.map(async detail => ({ purchase_order_id: detail.poId, note_path: await uploadTripDeliverySlip(trip.id, detail.poId, detail.slip), final_cost: detail.finalCost })));
      await api('/rest/v1/rpc/complete_delivery_trip', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ trip: trip.id, deliveries }) });
      const corrected = (trip.delivery_trip_pos || []).some(link => link.delivery_status === 'Needs Correction');
      closeCompleteTripDialog(); await loadData(); toast(corrected ? t('correctedResubmitted') : t('deliveryUpdated'));
    } catch (err) { error.textContent = err.message || t('couldNotComplete'); }
    finally { button.disabled = false; button.textContent = t('completeDelivery'); }
  }
  async function deleteTripEntry(tripId, button) {
    const trip = trips.find(item => item.id === tripId); if (!trip || !confirm(t('deleteTripConfirm'))) return;
    const originalText = button.textContent;
    try {
      button.disabled = true; button.textContent = '…';
      await api('/rest/v1/rpc/delete_delivery_trip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ trip: tripId })
      });
      selectedPoIds.clear();
      await loadData();
      toast(t('tripDeleted'));
    } catch (err) {
      toast(err.message || t('couldNotDeleteTrip'));
    } finally {
      button.disabled = false; button.textContent = originalText;
    }
  }

  function toggleCustomDates() { $('customDateFilters').classList.toggle('hidden', $('dateRangeFilter').value !== 'custom'); }
  function clearFilters() { $('searchInput').value = ''; $('statusFilter').value = ''; $('dateRangeFilter').value = ''; $('dateFrom').value = ''; $('dateTo').value = ''; toggleCustomDates(); render(); }
  function bindEvents() {
    ['languageSelect', 'loginLanguageSelect'].forEach(id => $(id).addEventListener('change', event => applyLanguage(event.target.value)));
    $('loginForm').addEventListener('submit', async event => { event.preventDefault(); $('loginError').textContent = ''; try { await signIn($('emailInput').value.trim(), $('passwordInput').value); await start(); } catch (error) { $('loginError').textContent = error.message || t('signInFailed'); } });
    $('signOutBtn').addEventListener('click', signOut); $('refreshBtn').addEventListener('click', loadData); $('clearFilters').addEventListener('click', clearFilters); $('tripPlanForm').addEventListener('submit', saveTrip);
    $('openManualPoBtn').addEventListener('click', openManualPoDialog);
    $('manualPoForm').addEventListener('submit', saveManualPo);
    $('closeManualPoBtn').addEventListener('click', closeManualPoDialog);
    $('cancelManualPoBtn').addEventListener('click', closeManualPoDialog);
    $('appointmentForm').addEventListener('submit', saveAppointmentDate);
    $('closeAppointmentBtn').addEventListener('click', closeAppointmentDialog);
    $('cancelAppointmentBtn').addEventListener('click', closeAppointmentDialog);
    $('openTripDialogBtn').addEventListener('click', openCreateTrip);
    $('closeTripDialogBtn').addEventListener('click', closeTripDialog); $('cancelTripBtn').addEventListener('click', closeTripDialog);
    $('tripPoDetails').addEventListener('change', event => { if (event.target.matches('.po-invoice-file')) handleInvoiceFile(event.target); });
    $('completeTripForm').addEventListener('submit', completeTrip); $('closeCompleteTripBtn').addEventListener('click', closeCompleteTripDialog); $('cancelCompleteTripBtn').addEventListener('click', closeCompleteTripDialog);
    $('completeTripPoDetails').addEventListener('input', event => { if (event.target.matches('.complete-po-cost')) updateCompleteTripTotal(); });
    $('inTripBody').addEventListener('click', event => {
      const editButton = event.target.closest('.edit-trip-btn'), completeButton = event.target.closest('.complete-trip-btn'), deleteButton = event.target.closest('.delete-trip-btn');
      if (editButton) openEditTrip(editButton.dataset.tripId);
      else if (completeButton) openCompleteTrip(completeButton.dataset.tripId);
      else if (deleteButton) deleteTripEntry(deleteButton.dataset.tripId, deleteButton);
    });
    ['searchInput', 'statusFilter', 'dateFrom', 'dateTo'].forEach(id => { $(id).addEventListener('input', render); $(id).addEventListener('change', render); });
    $('dateRangeFilter').addEventListener('change', () => { toggleCustomDates(); render(); });
    $('poTableBody').addEventListener('click', event => {
      const appointmentButton = event.target.closest('.appointment-edit-btn');
      if (appointmentButton) openAppointmentDialog(appointmentButton.dataset.poId);
    });
    $('poTableBody').addEventListener('change', event => { if (!event.target.matches('.po-choice')) return; if (event.target.checked) selectedPoIds.add(event.target.value); else selectedPoIds.delete(event.target.value); render(); });
    $('selectAllPos').addEventListener('change', event => { filteredRecords().forEach(record => event.target.checked ? selectedPoIds.add(record.id) : selectedPoIds.delete(record.id)); render(); });
  }
  async function start() {
    if (!BASE_URL || !PUBLIC_KEY) { show('loginScreen'); $('loginError').textContent = t('notConfigured'); return; }
    $('signedInAs').textContent = session?.user?.email || '';
    const role = await api('/rest/v1/rpc/po_tracker_role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => '');
    $('receivablesNav').classList.toggle('hidden', !['owner', 'accountant'].includes(role));
    $('analyticsNav').classList.toggle('hidden', !['owner', 'accountant'].includes(role));
    hide('loginScreen'); show('app'); $('tripDate').value = today(); await loadData(); clearInterval(refreshTimer); refreshTimer = setInterval(loadData, 60000);
  }

  bindEvents(); applyLanguage(currentLanguage); toggleCustomDates();
  try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { session = null; }
  if (session?.access_token && session?.refresh_token) start().catch(error => { hide('app'); show('loginScreen'); $('loginError').textContent = error.message || t('signInAgain'); });
  else { sessionStorage.removeItem(SESSION_KEY); show('loginScreen'); }
})();
