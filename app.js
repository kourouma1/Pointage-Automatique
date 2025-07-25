const { exec } = require("child_process");
const os = require("os");
const moment = require("moment");
require("./config/db");
const Employe = require("./models/employe");
const Presence = require("./models/presence");
const { log } = require("console");

// Cache pour les employés
let employeCache = new Map();

// Exécuter une commande système
function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout) => {
      if (err) {
        console.error(`Erreur lors de l'exécution de ${cmd}: ${err.message}`);
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

// Ping une plage d'IP en parallèle
async function pingAllIps(prefix = "192.168.2.", start = 1, end = 254) {
  const pingPromises = [];
  for (let i = start; i <= end; i++) {
    const ip = `${prefix}${i}`;
    pingPromises.push(
      pingIP(ip).then((actif) => (actif ? ip : null))
    );
  }
  const results = await Promise.all(pingPromises);
  return results.filter((ip) => ip !== null);
}

// Vider la table ARP
async function clearArpTable() {
  try {
    if (os.platform() === "linux" || os.platform() === "darwin") {
      await runCommand("sudo ip neigh flush all");
    } else if (os.platform() === "win32") {
      await runCommand("arp -d *");
    }
    console.log("🧹 Table ARP nettoyée.");
  } catch (err) {
    console.error("❌ Erreur lors du nettoyage de la tableARP :", err.message);
  }
}

// Extraire adresse MAC
function extractMAC(line) {
  const macRegex = /([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}/;
  const match = line.match(macRegex);
  return match ? match[0].toLowerCase() : null;
}

// Extraire adresse IP
function extractIP(line) {
  const ipRegex = /\(([^)]+)\)/;
  const match = line.match(ipRegex);
  return match ? match[1] : null;
}

// Valider adresse MAC
function isValidMAC(mac) {
  return /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(mac);
}

// Enregistrer une présence
async function enregistrerPresence(mac, ip) {
  if (!isValidMAC(mac)) {
    console.log(`❌ MAC invalide : ${mac} (IP : ${ip})`);
    return;
  }

  try {
    const today = moment().format("YYYY-MM-DD");
    const heure = moment().format("HH:mm");

    const employe = employeCache.get(mac) || (await Employe.findOne({ mac_address: mac }));
    if (!employe) {
      console.log(`\x1b[31m❌ MAC inconnue : ${mac} (IP : ${ip})\x1b[0m`);
      return;
    }

    const presence = await Presence.findOne({
      employe_id: employe._id,
      date: today,
    }).sort({ createdAt: -1 }); // Trouver la dernière entrée pour aujourd’hui

    if (presence) {
      if (presence.heure_depart) {
        // Réinitialiser heure_depart si l'employé est reconnecté
        presence.heure_depart = null;
        await presence.save();
        console.log(`🔄 ${employe.nom} reconnecté, heure de départ réinitialisée à null (IP : ${ip})`);
      } else {
        console.log(`⏳ ${employe.nom} déjà enregistré et session ouverte (IP : ${ip})`);
      }
      return;
    }

    // Créer une nouvelle entrée si aucune n'existe pour aujourd’hui
    await Presence.create({
      employe_id: employe._id,
      date: today,
      heure_arrivee: heure,
      heure_depart: null,
    });
    console.log(`✅ ${employe.nom} pointé à ${heure} depuis IP ${ip}`);
  } catch (err) {
    console.error(`🚨 Erreur pour ${mac} (${ip}) :`, err.message);
  }
}

// Ping une IP
function pingIP(ip) {
  return new Promise((resolve) => {
    exec(`ping -f -c 1 -W 1 ${ip}`, (err) => {
      resolve(!err);
    });
  });
}

// Récupérer l'IP depuis une MAC
function getIPfromMAC(mac) {
  return new Promise((resolve) => {
    exec("arp -a", (err, stdout) => {
      if (err) return resolve(null);
      const lignes = stdout.split("\n");
      for (const ligne of lignes) {
        if (ligne.toLowerCase().includes(mac.toLowerCase())) {
          const ipMatch = ligne.match(/\(([^)]+)\)/);
          if (ipMatch) return resolve(ipMatch[1]);
        }
      }
      resolve(null);
    });
  });
}

// Vérifier toutes les MACs
async function verifierToutesMACs() {
  const today = moment().format("YYYY-MM-DD");
  const heure = moment().format("HH:mm");

  const employes = await Employe.find({}).select("mac_address nom _id");
  for (const emp of employes) {
    const mac = emp.mac_address.toLowerCase();
    const ip = await getIPfromMAC(mac);

    if (!ip) {
      console.log(`❌ Aucune IP trouvée pour ${emp.nom} (MAC: ${mac}) - Déconnexion détectée`);
      await majHeureDepart(emp._id, emp.nom, heure, today);
      continue;
    }

    const actif = await pingIP(ip);
    if (!actif) {
      console.log(`❌ ${emp.nom} (${mac}) ne répond pas au ping sur IP ${ip} - Déconnexion détectée`);
      await majHeureDepart(emp._id, emp.nom, heure, today);
    } else {
      console.log(`✅ ${emp.nom} (${mac}) est actif sur IP ${ip}`);
    }
  }
}

// Mettre à jour l'heure de départ
async function majHeureDepart(employe_id, nom, heure, today) {
  const presence = await Presence.findOne({
    employe_id,
    date: today,
    heure_depart: null, // Uniquement les sessions ouvertes
  }).sort({ createdAt: -1 }); // Trouver la dernière entrée ouverte pour aujourd’hui

  if (presence) {
    presence.heure_depart = heure;
    await presence.save();
    console.log(`🚪 Heure de départ mise à jour pour ${nom} à ${heure}`);
  } else {
    console.log(`⚠️ Aucune session ouverte trouvée pour ${nom} aujourd’hui ou heure de départ déjà définie`);
  }
}

// Charger le cache des employés
async function loadEmployeCache() {
  try {
    const employes = await Employe.find({}).select("mac_address nom _id");
    employeCache.clear();
    employes.forEach((emp) => employeCache.set(emp.mac_address.toLowerCase(), emp));
    console.log("🗄 Cache des employés mis à jour.");
  } catch (err) {
    console.error("❌ Erreur lors du chargement du cache :", err.message);
  }
}

// Boucle principale
let compteur = 0;
setInterval(async () => {
  try {
    const stdout = await runCommand("arp -a");
    const lignes = stdout.split("\n");
    lignes.forEach((ligne) => {
      const mac = extractMAC(ligne);
      const ip = extractIP(ligne);
      if (mac && ip) {
        enregistrerPresence(mac, ip);
        //console.log(`Enregistrement de MAC effectué ====> ${mac}, IP ====> ${ip}`);
      }
    });

    compteur++;
    if (compteur % 600 === 0) {
      await clearArpTable();
      await pingAllIps();
      compteur = 0;
      log("🧹 Table ARP nettoyée après 600 itérations.");
    }
  } catch (err) {
    console.error("❌ Erreur dans la boucle principale :", err.message);
  }
}, 5000);

// Vérification périodique des MACs
setInterval(verifierToutesMACs, 30000);

// Initialiser le cache des employés
loadEmployeCache();
setInterval(loadEmployeCache, 60000);