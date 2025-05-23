module.exports = {
  name: 'WireShark OUI',
  acronym: 'OUI',
  description: 'Lookup Organizationally Unique Identifiers (OUIs) from the Wireshark "manuf" database file',
  entityTypes: ['MAC'],
  defaultColor: 'light-gray',
  styles: ['./styles/styles.less'],
  block: {
    component: {
      file: './components/block.js'
    },
    template: {
      file: './templates/block.hbs'
    }
  },
  request: {
    cert: '',
    key: '',
    passphrase: '',
    ca: '',
    proxy: ''
  },
  logging: {
    level: 'info'
  },
  options: [
    {
      key: 'autoUpdate',
      name: 'Automatically Update OUI Database',
      description:
        "If enabled, the integration will automatically update the OUI database from Wireshark's download server once a week. Defaults to enabled.",
      default: true,
      type: 'boolean',
      userCanEdit: false,
      adminOnly: true
    },
    {
      key: 'returnMisses',
      name: 'Always return results',
      description:
        'If enabled, the integration will return a result even if the MAC address has no vendor assignment.  Defaults to enabled.',
      default: true,
      type: 'boolean',
      userCanEdit: false,
      adminOnly: true
    }
  ]
};
