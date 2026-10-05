export type SatellitesStackParamList = {
  Passes: undefined;
  PassDetail: { passId: string };
  Capture: undefined;
  SondeHunt: { serial: string };
};

export type ProfileStackParamList = {
  ProfileHome: undefined;
  Recordings: undefined;
  Settings: undefined;
};

export type RootTabParamList = {
  Map: undefined;
  Radio: undefined;
  Satellites: undefined;
  Profile: undefined;
};
