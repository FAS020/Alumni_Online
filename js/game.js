(function () {
	// Start van de IIFE
	const canvas = document.getElementById("canvas");
	const ctx = canvas.getContext("2d");

	// ─────────────────────────────────────────────
	// 🌐 MULTIPLAYER SETUP (SOCKET.IO)
	// ─────────────────────────────────────────────
	let socket;
	let otherPlayers = {}; // Hier slaan we de andere spelers op
	let mySocketId = null;
	let myName = "Jij"; // NIEUW: Variabele voor eigen naam
	let myColor = "blue"; // NIEUW: Variabele voor eigen kleur
	let isUserAdmin = false; // NIEUW: Houdt bij of de gebruiker admin is
	const nameHoverStates = {}; // NIEUW: Houdt hover status bij voor fade-out
	let isRoomOwner = false; // Ben ik de eigenaar van de huidige kamer?

	// NIEUW: Global debt
	let myDebt = 0;

	function updateDebtDisplay() {
		let el = document.getElementById("debtDisplay");
		if (!el) {
			// Maak element aan als het niet bestaat
			const container = document.getElementById("uiContainer") || document.body;
			el = document.createElement("div");
			el.id = "debtDisplay";
			el.style.position = "absolute";
			el.style.top = "100px";
			el.style.right = "20px";
			el.style.color = "#ff4444";
			el.style.fontFamily = "Arial, sans-serif";
			el.style.fontSize = "18px";
			el.style.fontWeight = "bold";
			el.style.textShadow = "1px 1px 0 #000";
			el.style.pointerEvents = "none";
			el.style.zIndex = "100";
			el.style.display = "none";
			container.appendChild(el);
		}

		if (myDebt > 0) {
			el.innerHTML = `💸 Schuld: €${myDebt.toFixed(2)}`;
			el.style.display = "block";
		} else {
			el.style.display = "none";
		}
	}
	let myRoomId = null; // ID van MIJN kamer (ongeacht waar ik ben)
	let myRoomSettings = {
		doorbell: false,
		alwaysOnline: false,
		allowBuilding: false,
		noSmoking: false,
		isOutside: false,
		weather: "clear",
		time: "day",
	}; // Instellingen van MIJN kamer
	let currentRoomSettings = {
		doorbell: false,
		alwaysOnline: false,
		allowBuilding: false,
		noSmoking: false,
		isOutside: false,
		weather: "clear",
		time: "day",
	}; // Instellingen van huidige kamer

	// NIEUW: Vriendenlijst
	let myFriends = [];
	let isWaitingForDoorbell = false; // Voorkom spammen van de bel

	// NIEUW: Check for post-redirect messages
	(function checkSessionMessages() {
		const wasKicked = sessionStorage.getItem("wasKicked");
		if (wasKicked) {
			showAlert({ message: "Je bent uit de kamer gezet!", icon: "icons/rooms.png" });
			sessionStorage.removeItem("wasKicked");
		}
		const wasClosed = sessionStorage.getItem("roomClosed");
		if (wasClosed) {
			showAlert({ message: "De eigenaar is vertrokken.", subMessage: "Je bent terug in het Atrium.", icon: "icons/rooms.png" });
			sessionStorage.removeItem("roomClosed");
		}
	})();

	// Genereer of laad een uniek User ID voor eigenaarschap
	let myUserId = sessionStorage.getItem("habboUserId"); // Changed to sessionStorage for testing
	if (!myUserId) {
		myUserId = "user_" + Math.random().toString(36).substr(2, 9);
		sessionStorage.setItem("habboUserId", myUserId);
	}

	try {
		socket = io();

		socket.on("connect", () => {
			mySocketId = socket.id;

			// Haal laatst bekende positie op uit localStorage
			let savedPos = null;
			// Check URL voor room ID
			const urlParams = new URLSearchParams(window.location.search);
			const roomId = urlParams.get("room") || "testroom";
			const sizeParam = urlParams.get("size");
			const aoVal = urlParams.get("alwaysOnline");
			const alwaysOnlineParam = aoVal === null ? null : aoVal === "true";
			const abVal = urlParams.get("allowBuilding");
			const allowBuildingParam = abVal === null ? null : abVal === "true";
			const nsVal = urlParams.get("noSmoking");
			const noSmokingParam = nsVal === null ? null : nsVal === "true";
			const outVal = urlParams.get("isOutside");
			const isOutsideParam = outVal === null ? null : outVal === "true";
			const weatherParam = urlParams.get("weather");
			const timeParam = urlParams.get("time");

			try {
				const stored = localStorage.getItem(`habboCloneLastPos_${roomId}`);
				if (stored) savedPos = JSON.parse(stored);
			} catch (e) {}

			// Vraag om mee te doen op deze positie
			const sizeToSend = sizeParam && sizeParam.includes("x") ? sizeParam : sizeParam ? parseInt(sizeParam) : null;
			socket.emit("joinRoom", {
				roomId: roomId,
				...savedPos,
				size: sizeToSend,
				userId: myUserId,
				alwaysOnline: alwaysOnlineParam,
				allowBuilding: allowBuildingParam,
				noSmoking: noSmokingParam,
				isOutside: isOutsideParam,
				weather: weatherParam || "clear",
				time: timeParam || "day",
			});

			// NIEUW: Vraag data van MIJN kamer op
			socket.emit("getMyRoomData", myUserId);

			// NIEUW: Vraag de lijst met custom objects op van de server
			socket.emit("getCustomObjects");

			// NIEUW: Vraag de vriendenlijst op
			socket.emit("getFriends");

			// NIEUW: Vraag mijn inventory en geld op van de server
			socket.emit("getPlayerData", myUserId);

			// Update de chatlog nu we een ID hebben, zodat eigen berichten links staan
			updateChatLog();
		});

		socket.on("joinError", (msg) => {
			alert(msg);
			window.location.search = "?room=atrium"; // Terug naar atrium
		});

		// Ontvang data van mijn kamer
		socket.on("myRoomData", (data) => {
			if (data.roomId) {
				myRoomId = data.roomId;
				myRoomSettings = data.settings || {
					doorbell: false,
					alwaysOnline: false,
					allowBuilding: false,
					noSmoking: false,
					isOutside: false,
					weather: "clear",
					time: "day",
				};
				if (document.getElementById("myRoomWindow").style.display === "flex") {
					renderMyRoomSettings();
				}
			}
		});
		socket.on("myRoomSettingsUpdated", (data) => {
			if (data.roomId === myRoomId) myRoomSettings = data.settings;
		});

		// Helper om custom objecten te voorzien van hun plaatje
		function hydrateObject(obj) {
			if (obj.isCustom && obj.image) {
				const existing = typeof buildableObjects !== "undefined" ? buildableObjects.find((b) => b.image === obj.image) : null;
				if (existing && existing.runtimeImage) {
					obj.runtimeImage = existing.runtimeImage;
				} else {
					const img = new Image();
					img.src = obj.image;
					obj.runtimeImage = img;
				}
			}
		}

		// Server bevestigt deelname en geeft huidige status
		socket.on("initGame", (data) => {
			myUserId = data.id; // Store ID
			isOwner = data.isOwner;
			myDebt = data.debt || 0; // NIEUW: Ontvang schuld
			updateDebtDisplay();

			updateBuildButton();
			console.log("Joined game at", data.startX, data.startY);
			ball.x = data.startX;
			ball.y = data.startY;

			// NIEUW: Check debt
			myDebt = data.debt || 0;
			updateDebtDisplay(); // Toon schuld

			const urlParams = new URLSearchParams(window.location.search);
			const roomId = urlParams.get("room") || "testroom";

			// Update map grootte als de server die meestuurt
			if (data.mapW && !isNaN(data.mapW)) mapW = data.mapW;
			if (data.mapH && !isNaN(data.mapH)) mapH = data.mapH;

			// Check eigenaarschap
			isRoomOwner = data.isOwner || false;
			currentRoomSettings = data.roomSettings || {
				doorbell: false,
				alwaysOnline: false,
				allowBuilding: false,
				noSmoking: false,
				isOutside: false,
				weather: "clear",
				time: "day",
			};
			updateBuildButton(); // Update footer button state

			// Overschrijf onze lokale lijsten met die van de server
			if (data.objects) {
				objects.length = 0;
				// Als de testroom leeg is op de server, vul hem met de standaard objecten.
				if (roomId === "testroom" && data.objects.length === 0) {
					defaultTestRoomObjects.forEach((o) => objects.push(o));
				} else {
					data.objects.forEach((o) => {
						hydrateObject(o);
						objects.push(o);
					});
				}
			}
			if (data.wallObjects) {
				wallObjects.length = 0;
				data.wallObjects.forEach((o) => {
					hydrateObject(o);
					wallObjects.push(o);
				});
			}
			// Laad items van server
			if (data.items) {
				items.length = 0;
				data.items.forEach((i) => items.push(createItemFromData(i)));
			}
			if (data.tileColors) {
				for (const key in tileColors) delete tileColors[key];
				Object.assign(tileColors, data.tileColors);
			}
			if (data.wallColors) {
				for (const key in wallColors) delete wallColors[key];
				Object.assign(wallColors, data.wallColors);
			}

			// Laad puddles van server of reset
			if (data.puddles) {
				tilePuddles = data.puddles;
			} else {
				tilePuddles = {};
			}

			if (data.snow) {
				tileSnow = data.snow;
			} else {
				tileSnow = {};
			}

			// Laad marks
			if (data.marks) {
				activeMarks = data.marks;
			} else {
				activeMarks = [];
			}
			activeSplashes = [];
		});

		// Luister naar updates van de kamer
		socket.on("updateObjects", (serverObjects) => {
			objects.length = 0;
			serverObjects.forEach((o) => {
				hydrateObject(o);
				objects.push(o);
			});
		});
		socket.on("updateWallObjects", (serverWallObjects) => {
			wallObjects.length = 0;
			serverWallObjects.forEach((o) => {
				hydrateObject(o);
				wallObjects.push(o);
			});
		});

		// NIEUW: Ontvang puddle updates van server (gesynced door eigenaar/host)
		socket.on("puddlesUpdate", (data) => {
			tilePuddles = data;
		});

		// NIEUW: Ontvang snow updates
		socket.on("snowUpdate", (data) => {
			tileSnow = data;
		});

		socket.on("updateTileColor", (data) => {
			tileColors[data.key] = data.color;
		});
		socket.on("updateWallColor", (data) => {
			wallColors[data.id] = data.color;
		});

		// NIEUW: Ontvang nieuwe marks van anderen
		socket.on("placeMarks", (newMarks) => {
			activeMarks.push(...newMarks);
		});

		// NIEUW: Update alle marks (bijv. na verwijderen muur)
		socket.on("updateMarks", (allMarks) => {
			activeMarks = allMarks;
		});

		// NIEUW: Kamer grootte aangepast
		socket.on("roomResized", (data) => {
			mapW = data.mapW;
			mapH = data.mapH;
			showNotification(`Kamer grootte aangepast naar ${mapW}x${mapH}`);
		});

		// Luister naar item updates (verplaatsingen door anderen)
		socket.on("updateItems", (serverItems) => {
			// Maak een map van huidige items om lokale state te behouden
			const currentMap = new Map(items.map((i) => [i.id, i]));

			items.length = 0;
			serverItems.forEach((serverItem) => {
				const localItem = currentMap.get(serverItem.id);

				// Als we dit item al hebben EN wij zijn de eigenaar, behoud lokale physics state
				if (localItem && localItem.lastTouchedBy === mySocketId && serverItem.lastTouchedBy === mySocketId) {
					items.push(localItem);
				} else {
					items.push(createItemFromData(serverItem));
				}
			});
		});

		// NIEUW: Ontvang live physics updates van andere spelers
		socket.on("updateItemPhysics", (updates) => {
			updates.forEach((u) => {
				const item = items.find((i) => i.id === u.id);
				if (item && item !== draggedItem) {
					// Update niet als wij het zelf slepen
					item.x = u.x;
					item.y = u.y;
					item.z = u.z;
					item.vx = u.vx;
					item.vy = u.vy;
					item.vz = u.vz;
					item.rotation = u.rotation;
					item.vr = u.vr;
					item.lastTouchedBy = u.lastTouchedBy; // Neem eigenaar over van server
				}
			});
		});

		// Synchroniseer de spelerslijst (vervangt newPlayer/playerDisconnected)
		socket.on("updatePlayerList", (allPlayers) => {
			console.log("Spelerslijst ontvangen:", allPlayers); // Debug log

			// NIEUW: Update eigen naam als we die in de lijst vinden
			if (mySocketId && allPlayers[mySocketId]) {
				myName = allPlayers[mySocketId].name;
				myColor = allPlayers[mySocketId].color; // Update eigen kleur
			}

			const newIds = Object.keys(allPlayers);

			// 1. Voeg nieuwe spelers toe
			newIds.forEach((id) => {
				if (id !== socket.id && id !== mySocketId && !otherPlayers[id]) {
					otherPlayers[id] = allPlayers[id];
					if (otherPlayers[id].isSmoking) {
						otherPlayers[id].smokingStartTime = Date.now(); // Fallback starttijd voor nieuwe spelers
					}
					if (otherPlayers[id].isDrinking) {
						otherPlayers[id].drinkingStartTime = Date.now();
					}
				}
			});

			// 2. Verwijder spelers die weg zijn
			Object.keys(otherPlayers).forEach((id) => {
				if (!allPlayers[id]) {
					delete otherPlayers[id];
					if (nameHoverStates[id]) delete nameHoverStates[id];
				}
			});
		});

		// NIEUW: Ontvang de lijst met bestaande custom objects
		socket.on("customObjectList", (objectsFromServer) => {
			console.log(`Ontvangen: ${objectsFromServer.length} custom objects van server.`);
			objectsFromServer.forEach((obj) => {
				// Voorkom duplicaten
				if (!buildableObjects.some((b) => b.name === obj.name && b.image === obj.image)) {
					const img = new Image();
					img.src = obj.image;
					obj.runtimeImage = img;
					buildableObjects.push(obj);
				}
			});
			// NIEUW: Ververs het bouwmenu direct als het open staat
			if (isBuildMode && activeBuildCategory === "objecten") {
				renderBuildItems();
			}
		});

		// NIEUW: Ontvang een nieuw toegevoegd custom object
		socket.on("customObjectAdded", (newObj) => {
			console.log("Nieuw custom object ontvangen:", newObj);
			const img = new Image();
			img.src = newObj.image;
			newObj.runtimeImage = img;
			buildableObjects.push(newObj);

			// Als het bouwmenu open is, ververs de lijst
			if (isBuildMode && activeBuildCategory === "objecten") {
				renderBuildItems();
			}
			showNotification(`Nieuw object toegevoegd: ${newObj.name}`);
		});

		// NIEUW: Custom object bijgewerkt
		socket.on("customObjectUpdated", (data) => {
			const idx = buildableObjects.findIndex((b) => b.name === data.originalName && b.isCustom);
			if (idx > -1) {
				// Update lokale definitie
				const img = new Image();
				img.src = data.object.image;
				data.object.runtimeImage = img;
				buildableObjects[idx] = data.object;

				if (isBuildMode && activeBuildCategory === "objecten") {
					renderBuildItems();
				}
				showNotification(`Object "${data.object.name}" bijgewerkt.`);
			}
		});

		// NIEUW: Custom object verwijderd door admin
		socket.on("customObjectDeleted", (data) => {
			const { name, price } = data;

			// NIEUW: Deselecteer het object als het momenteel geselecteerd is
			if (selectedBuildObject && selectedBuildObject.name === name && selectedBuildObject.isCustom) {
				selectedBuildObject = null;
				// De renderBuildItems() hieronder zal de visuele deselectie afhandelen
			}

			// Verwijder uit bouwmenu lijst
			const idx = buildableObjects.findIndex((b) => b.name === name && b.isCustom);
			if (idx > -1) {
				buildableObjects.splice(idx, 1);
				if (isBuildMode) renderBuildItems();
			}

			// Check inventaris en geef geld terug
			let refundCount = 0;
			for (let i = inventoryItems.length - 1; i >= 0; i--) {
				if (inventoryItems[i].name === name) {
					inventoryItems.splice(i, 1);
					refundCount++;
				}
			}

			if (refundCount > 0 && price > 0) {
				const totalRefund = refundCount * price;
				addToWallet(totalRefund);
				showNotification(`€${totalRefund.toFixed(2)} terugbetaald aan portemonnee voor ${refundCount} verwijderde "${name}" item(s).`);
			}
			savePlayerData();
		});

		// NIEUW: Refund ontvangen (voor geplaatste items)
		socket.on("refund", (data) => {
			addToWallet(data.amount);
			showNotification(`<span style="color: #7bff00;">+€${data.amount.toFixed(2).replace(".", ",")}</span> (${data.reason})`);
		});

		// NIEUW: Luister naar data van de server
		socket.on("playerData", (data) => {
			if (data) {
				walletBalance = data.wallet || 0;
				document.getElementById("wallet").textContent = `€${walletBalance.toFixed(2)}`;

				if (Array.isArray(data.inventory)) {
					inventoryItems.length = 0;
					data.inventory.forEach((itemData) => {
						inventoryItems.push(createItemFromData(itemData));
					});
					// Als inventory open staat, ververs de weergave
					if (document.getElementById("inventory").style.display === "flex") {
						renderInventoryItems();
					}
				}
			}
		});

		// NIEUW: Resultaat van aanbellen (voor bezoeker)
		socket.on("doorbellResult", (data) => {
			isWaitingForDoorbell = false;
			if (data.accepted) {
				window.location.search = `?room=${data.roomId}`;
			} else {
				showNotification("Toegang geweigerd door eigenaar.");
			}
		});

		// NIEUW: Vriendenlijst ontvangen
		socket.on("friendsList", (friends) => {
			const content = document.getElementById("friendsContent");
			myFriends = friends; // Update lokale lijst
			content.innerHTML = "";

			if (friends.length === 0) {
				content.innerHTML = '<div style="text-align:center; color:#aaa; margin-top:20px;">Je hebt nog geen vrienden.</div>';
				return;
			}

			const urlParams = new URLSearchParams(window.location.search);
			const currentRoomId = urlParams.get("room") || "testroom";

			friends.forEach((f) => {
				const row = document.createElement("div");
				row.style.display = "flex";
				row.style.justifyContent = "space-between";
				row.style.alignItems = "center";
				row.style.padding = "8px 0";
				row.style.borderBottom = "1px solid #333";

				const name = document.createElement("span");
				name.textContent = f.name;

				// Klik op naam om te joinen als online
				if (f.isOnline && f.roomId && f.roomId !== currentRoomId) {
					name.style.cursor = "pointer";
					name.title = "Ga naar vriend";
					name.onclick = () => {
						window.location.search = `?room=${f.roomId}`;
					};
				}

				const statusDiv = document.createElement("div");
				statusDiv.style.display = "flex";
				statusDiv.style.alignItems = "center";
				statusDiv.style.gap = "8px";

				// Online status icon
				const statusIcon = document.createElement("img");
				statusIcon.src = f.isOnline ? "icons/groen.png" : "icons/rood.png";
				statusIcon.style.width = "12px";
				statusIcon.style.height = "12px";
				statusIcon.title = f.isOnline ? "Online" : "Offline";

				const delBtn = document.createElement("img");
				delBtn.src = "icons/trash.png";
				delBtn.style.width = "16px";
				delBtn.style.height = "16px";
				delBtn.style.cursor = "pointer";
				delBtn.title = "Vriend verwijderen";
				delBtn.onclick = () => {
					showConfirmation({
						message: `Wil je ${f.name} verwijderen als vriend?`,
						icon: "icons/trash.png",
						onConfirm: () => socket.emit("removeFriend", f.userId),
					});
				};

				statusDiv.appendChild(statusIcon);
				statusDiv.appendChild(delBtn);

				row.appendChild(name);
				row.appendChild(statusDiv);
				content.appendChild(row);
			});
		});

		// NIEUW: Room settings updated
		socket.on("roomSettingsUpdated", (settings) => {
			currentRoomSettings = settings;
			updateBuildButton();
		});

		// NIEUW: Kicked
		socket.on("kicked", (roomId) => {
			sessionStorage.setItem("wasKicked", "true");
			window.location.search = "?room=atrium";
		});

		// NIEUW: Room Closed (Owner left)
		socket.on("roomClosed", () => {
			sessionStorage.setItem("roomClosed", "true");
			window.location.search = "?room=atrium";
		});

		// NIEUW: Friend Request Received
		socket.on("friendRequestReceived", (data) => {
			showConfirmation({
				message: `${data.senderName} wil vrienden met je worden`,
				icon: "icons/heart.png",
				confirmText: "Accepteren",
				denyText: "Weigeren",
				onConfirm: () => {
					socket.emit("respondFriendRequest", { senderId: data.senderId, accepted: true });
					socket.emit("getFriends"); // Update onze lijst
				},
				onDeny: () => {
					socket.emit("respondFriendRequest", { senderId: data.senderId, accepted: false });
				},
			});
		});

		// NIEUW: Friend Request Result
		socket.on("friendRequestResult", (data) => {
			if (data.accepted) {
				showAlert({
					message: `${data.responderName} heeft je verzoek geaccepteerd!`,
					icon: "icons/heart_active.png",
				});
				socket.emit("getFriends"); // Update onze lijst
			} else {
				showAlert({
					message: `${data.responderName} heeft je verzoek geweigerd.`,
					icon: "icons/heart.png",
				});
			}
		});

		// NIEUW: Vote Kick Started
		socket.on("voteKickStarted", (data) => {
			// Als jij het target bent, krijg je geen vote optie (of een melding)
			if (data.targetId === socket.id) {
				showNotification(`Er is een stemming gestart om jou te kicken door ${data.initiatorName}.`);
				return;
			}

			// Als jij de initiator bent, krijg je geen popup (je hebt al automatisch voorgestemd)
			if (data.initiatorId === socket.id) {
				showNotification(`Stemming gestart om ${data.targetName} te kicken.`);
				return;
			}

			showConfirmation({
				message: `Stemming: ${data.targetName} kicken?`,
				subMessage: `Gestart door ${data.initiatorName}`,
				icon: "icons/kick.png",
				confirmText: "Ja",
				denyText: "Nee",
				onConfirm: () => socket.emit("castKickVote", { vote: true }),
				onDeny: () => socket.emit("castKickVote", { vote: false }),
			});
		});

		// NIEUW: Vote Update (teller)
		socket.on("voteUpdate", (data) => {
			const el = document.getElementById("voteCounter");
			el.style.display = "block";
			el.innerHTML = `Stemming ${data.targetName}:<br><strong>${data.count} / ${data.needed}</strong> stemmen`;
		});

		// NIEUW: Vote Kick Result
		socket.on("voteKickResult", (data) => {
			document.getElementById("voteCounter").style.display = "none";
			if (data.success) {
				showNotification(`${data.targetName} is uit de kamer gestemd.`);
			} else {
				showNotification(`Stemming mislukt. ${data.targetName} mag blijven.`);
			}
		});

		// NIEUW: Iemand belt aan (alleen voor eigenaar relevant)
		socket.on("doorbellRung", (data) => {
			if (!isRoomOwner) return; // Alleen eigenaar reageert
			showConfirmation({
				message: "Iemand belt aan!",
				subMessage: "Wil je deze speler binnenlaten?",
				icon: "icons/bel.png",
				confirmText: "Binnenlaten",
				denyText: "Weigeren",
				onConfirm: () => socket.emit("answerDoorbell", { visitorId: data.visitorId, accepted: true }),
				onDeny: () => socket.emit("answerDoorbell", { visitorId: data.visitorId, accepted: false }),
			});
		});

		socket.on("playerMoved", (playerInfo) => {
			if (otherPlayers[playerInfo.id]) {
				const p = otherPlayers[playerInfo.id];
				p.startX = p.x;
				p.startY = p.y;
				p.targetX = playerInfo.x;
				p.targetY = playerInfo.y;
				p.progress = 0;
				p.moving = true;
				if (playerInfo.isSmoking && !p.isSmoking) {
					p.smokingStartTime = Date.now(); // NIEUW: Starttijd zetten als iemand begint te roken
				}
				p.isSmoking = playerInfo.isSmoking; // NIEUW: Update rookstatus van anderen
				p.smokingItemType = playerInfo.smokingItemType; // NIEUW: Update type sigaret

				if (playerInfo.isDrinking && !p.isDrinking) {
					p.drinkingStartTime = Date.now();
				}
				p.isDrinking = playerInfo.isDrinking;
				p.drinkingItemType = playerInfo.drinkingItemType;
			}
		});

		// Ontvang chatgeschiedenis bij binnenkomst
		socket.on("chatHistory", (history) => {
			history.forEach((msg) => {
				receiveChatMessage(msg);
			});
		});

		// 🏓 PONG EVENTS
		socket.on("startPongAI", () => {
			startPongGame(true, "AI"); // true = AI mode
		});

		socket.on("pongWaiting", (data) => {
			showNotification(`Wachten op ${data.opponentName}...`);
		});

		socket.on("pongChallenge", (data) => {
			// Toon een speciale notificatie met knop
			const notif = document.getElementById("notification");
			// Zorg dat we kunnen klikken op de knoppen (standaard is notification pointer-events: none)
			notif.style.pointerEvents = "auto";

			notif.innerHTML = `
            <div id="pongNotification" class="popup-content">
                <div class="popup-sub">${data.challengerName} wil tafeltennissen!</div>
                <div class="popup-actions">
                    <button id="acceptPongBtn" class="popup-btn confirm">Accepteren</button>
                    <button id="declinePongBtn" class="popup-btn deny">Weigeren</button>
                </div>
            </div>
        `;
			notif.style.display = "block";
			notif.style.opacity = "1";

			document.getElementById("acceptPongBtn").onclick = () => {
				// Check of speler een batje heeft
				const hasPaddle = inventoryItems.some((item) => item.name && item.name.toLowerCase().includes("batje"));
				if (hasPaddle) {
					socket.emit("acceptPong", { challengerId: data.challengerId });
					notif.style.pointerEvents = "none"; // Reset
					notif.style.display = "none";
				} else {
					showNotification("Je hebt een batje nodig om te accepteren!");
				}
			};

			document.getElementById("declinePongBtn").onclick = () => {
				notif.style.pointerEvents = "none"; // Reset
				notif.style.display = "none";
				// Optioneel: stuur een 'decline' bericht terug naar de server/uitdager
			};
		});

		socket.on("startPongPvP", (data) => {
			startPongGame(false, data.opponentName, data.opponentId, data.isHost);
		});

		socket.on("pongBallUpdate", (data) => {
			pongBall.x = data.x;
			pongBall.y = data.y;
		});

		socket.on("pongScoreUpdate", (data) => {
			playerPaddle.score = data.playerScore;
			aiPaddle.score = data.aiScore;
			playerScoreEl.textContent = playerPaddle.score;
			aiScoreEl.textContent = aiPaddle.score;
		});

		socket.on("pongPaused", (data) => {
			initiatePongPause(data.name);
		});

		socket.on("pongStopped", (data) => {
			stopPongGame();
			showNotification(`${data.name} heeft het spel gestopt.`);
		});

		// NIEUW: Ontvang lijst met kamers
		socket.on("roomList", (rooms) => {
			const list = document.getElementById("roomList");
			if (!list) return;
			list.innerHTML = "";

			if (rooms.length === 0) {
				list.innerHTML = '<div style="padding: 5px; color: #aaa;">Geen kamers gevonden.</div>';
				return;
			}

			// NIEUW: Haal favoriete kamers op uit localStorage
			let starredRooms = [];
			try {
				starredRooms = JSON.parse(localStorage.getItem("habboCloneStarredRooms")) || [];
			} catch (e) {}

			let currentRoom = new URLSearchParams(window.location.search).get("room") || "testroom";
			const sortType = document.getElementById("roomSortSelect").value;

			// Sorteer logica:
			// 1. Favorieten (Starred) bovenaan
			// 2. Huidige kamer
			// 3. Dan op basis van selectie
			rooms.sort((a, b) => {
				const aStarred = starredRooms.includes(a.id);
				const bStarred = starredRooms.includes(b.id);
				if (aStarred && !bStarred) return -1;
				if (!aStarred && bStarred) return 1;

				if (a.id === currentRoom) return -1;
				if (b.id === currentRoom) return 1;

				if (sortType === "friends") {
					// Eerst op aantal vrienden, dan op aantal spelers
					if (b.friendCount !== a.friendCount) return b.friendCount - a.friendCount;
					return b.playerCount - a.playerCount;
				} else if (sortType === "quiet") {
					return a.playerCount - b.playerCount;
				}

				// Default: busy
				return b.playerCount - a.playerCount;
			});

			// Update ook de spelers kamerlijst (deze code stond dubbel, nu geconsolideerd in de loop)
			const roomsContent = document.getElementById("roomsContent");
			if (roomsContent) roomsContent.innerHTML = "";

			rooms.forEach((roomData) => {
				const roomId = roomData.id;

				// Verberg testroom voor spelers
				if (!isUserAdmin && roomId === "testroom") return;

				// Verberg offline kamers voor spelers
				if (!isUserAdmin && !roomData.isOwnerOnline && roomId !== "testroom") return;

				// Admin lijst item
				const row = document.createElement("div");
				row.style.display = "flex";
				row.style.justifyContent = "space-between";
				row.style.alignItems = "center";
				row.style.padding = "6px";
				row.style.borderBottom = "1px solid #444";

				const name = document.createElement("span");
				name.textContent = roomId;
				name.style.cursor = "pointer";
				name.style.flexGrow = "1";
				name.onclick = () => {
					if (roomData.playerCount >= roomData.maxPlayers) {
						showNotification("Kamer is vol!", "icons/player.png");
						return;
					}
					window.location.search = `?room=${roomId}`;
				};

				if (roomId === currentRoom) {
					name.style.color = "#7bff00";
				}

				// Player count info
				const playerCountDiv = document.createElement("div");
				playerCountDiv.style.display = "flex";
				playerCountDiv.style.alignItems = "center";
				// Geen gap, we gebruiken vaste slots voor uitlijning
				playerCountDiv.style.marginRight = "10px";

				// Helper voor vaste slots
				const createSlot = (src, title) => {
					const slot = document.createElement("div");
					slot.style.width = "15px"; // Vaste breedte per icoon
					slot.style.display = "flex";
					slot.style.justifyContent = "center";
					if (src) {
						const img = document.createElement("img");
						img.src = src;
						img.style.width = "12px";
						img.style.height = "12px";
						if (title) img.title = title;
						slot.appendChild(img);
					}
					return slot;
				};

				let iconSrc = "icons/player.png";
				let maxP = roomData.maxPlayers;

				if (roomId === "testroom") {
					iconSrc = "icons/admin.png";
				}

				// Slot 4: Player Icon
				playerCountDiv.appendChild(createSlot(iconSrc, "Spelers"));

				const countSpan = document.createElement("span");
				countSpan.textContent = `${roomData.playerCount}/${maxP}`;
				countSpan.style.width = "35px"; // Vaste breedte voor tekst
				countSpan.style.textAlign = "right";

				if (roomData.playerCount >= maxP) {
					countSpan.style.color = "#f44336";
				} else {
					countSpan.style.color = "#aaa";
				}

				playerCountDiv.appendChild(countSpan);

				const btnGroup = document.createElement("div");
				btnGroup.style.display = "flex";
				btnGroup.style.alignItems = "center";
				btnGroup.style.gap = "5px";

				if (roomId !== "testroom" && isUserAdmin) {
					// Always Online knop
					const aoBtn = document.createElement("button");
					const aoImg = document.createElement("img");
					aoImg.src = roomData.isAlwaysOnline ? "icons/wit.png" : "icons/rood.png";
					aoImg.style.width = "16px";
					aoImg.style.height = "16px";
					aoBtn.appendChild(aoImg);
					aoBtn.title = roomData.isAlwaysOnline ? "Zet Altijd Online UIT" : "Zet Altijd Online AAN";
					aoBtn.style.padding = "4px";
					aoBtn.style.cursor = "pointer";
					aoBtn.onclick = () => socket.emit("toggleAlwaysOnline", roomId);

					// Build Permission knop
					const buildBtn = document.createElement("button");
					const buildImg = document.createElement("img");
					buildImg.src = roomData.allowBuilding ? "icons/buildmenu_active.png" : "icons/buildmenu_inactive.png";
					buildImg.style.width = "16px";
					buildImg.style.height = "16px";
					buildBtn.appendChild(buildImg);
					buildBtn.title = roomData.allowBuilding ? "Bouwen toegestaan" : "Bouwen verboden";
					buildBtn.style.padding = "4px";
					buildBtn.style.cursor = "pointer";
					buildBtn.onclick = () => {
						socket.emit("toggleAllowBuilding", roomId);
					};

					// No Smoking knop
					const smokeBtn = document.createElement("button");
					const smokeImg = document.createElement("img");
					smokeImg.src = roomData.noSmoking ? "icons/verboden_active.png" : "icons/verboden.png";
					smokeImg.style.width = "16px";
					smokeImg.style.height = "16px";
					smokeBtn.appendChild(smokeImg);
					smokeBtn.title = roomData.noSmoking ? "Roken verboden" : "Roken toegestaan";
					smokeBtn.style.padding = "4px";
					smokeBtn.style.cursor = "pointer";
					smokeBtn.onclick = () => socket.emit("toggleNoSmoking", roomId);

					// Outside knop
					const sunBtn = document.createElement("button");
					const sunImg = document.createElement("img");
					sunImg.src = roomData.isOutside ? "icons/zon_active.png" : "icons/zon.png";
					sunImg.style.width = "16px";
					sunImg.style.height = "16px";
					sunBtn.appendChild(sunImg);
					sunBtn.title = roomData.isOutside ? "Is Buitenruimte" : "Is Binnenruimte";
					sunBtn.style.padding = "4px";
					sunBtn.style.cursor = "pointer";
					sunBtn.onclick = () => socket.emit("toggleIsOutside", roomId);

					// Weer knop (Toggle cycle: Clear -> Rain -> Snow -> Clear)
					const weatherBtn = document.createElement("button");
					const weatherIcons = { clear: "☁️", rain: "🌧️", snow: "❄️", mist: "🌫️", sun: "🌅" };
					weatherBtn.textContent = weatherIcons[roomData.weather] || "☀️";
					weatherBtn.title = `Weer: ${roomData.weather}`;
					weatherBtn.style.padding = "4px";
					weatherBtn.style.cursor = "pointer";
					weatherBtn.style.fontSize = "12px";
					weatherBtn.onclick = () => {
						const nextWeather = roomData.weather === "clear" ? "rain" : "clear"; // Simpele toggle voor lijst, admin menu heeft alles
						socket.emit("setRoomWeather", { roomId: roomId, weather: nextWeather });
					};

					// Hernoem knop
					const renameBtn = document.createElement("button");
					const renameImg = document.createElement("img");
					renameImg.src = "icons/rename.png";
					renameImg.style.width = "16px";
					renameImg.style.height = "16px";
					renameBtn.appendChild(renameImg);
					renameBtn.title = "Hernoem Kamer";
					renameBtn.style.padding = "4px";
					renameBtn.style.cursor = "pointer";

					renameBtn.onclick = () => {
						showInputPrompt({
							message: `Hernoem "${roomId}":`,
							defaultValue: roomId,
							onConfirm: (newName) => {
								if (newName && newName.trim() && newName.trim() !== roomId) {
									socket.emit("renameRoom", { oldId: roomId, newId: newName.trim() });
								}
							},
						});
					};

					// Verwijder knop
					const delBtn = document.createElement("button");
					const delImg = document.createElement("img");
					delImg.src = "icons/trash.png";
					delImg.style.width = "16px";
					delImg.style.height = "16px";
					delBtn.appendChild(delImg);
					delBtn.title = "Verwijder Kamer";
					delBtn.style.padding = "4px";
					delBtn.style.cursor = "pointer";

					delBtn.onmousedown = () => {
						delImg.src = "icons/trash_active.png";
					};
					delBtn.onmouseup = () => {
						delImg.src = "icons/trash.png";
					};
					delBtn.onmouseleave = () => {
						delImg.src = "icons/trash.png";
					};

					delBtn.onclick = () => {
						showConfirmation({
							message: `Weet je zeker dat je kamer "${roomId}" wilt verwijderen?`,
							icon: "icons/trash.png",
							onConfirm: () => socket.emit("deleteRoom", roomId),
						});
					};

					btnGroup.appendChild(aoBtn);
					btnGroup.appendChild(buildBtn);
					btnGroup.appendChild(smokeBtn);
					btnGroup.appendChild(sunBtn);
					btnGroup.appendChild(weatherBtn);
					btnGroup.appendChild(renameBtn);
					btnGroup.appendChild(delBtn);
				}

				row.appendChild(name);
				row.appendChild(playerCountDiv);
				row.appendChild(btnGroup);
				list.appendChild(row);
			});

			// Spelers lijst item (hergebruik de gesorteerde 'rooms' array)
			if (roomsContent) {
				if (rooms.length === 0) {
					roomsContent.innerHTML = '<div style="padding: 5px; color: #aaa;">Geen kamers gevonden.</div>';
				} else {
					rooms.forEach((roomData) => {
						const roomId = roomData.id;
						const playerCount = roomData.playerCount;
						const maxPlayers = roomData.maxPlayers;
						const hasDoorbell = roomData.hasDoorbell;
						const isAlwaysOnline = roomData.isAlwaysOnline;

						// Verberg testroom voor spelers
						if (!isUserAdmin && roomId === "testroom") return;

						// Verberg offline kamers voor spelers
						if (!isUserAdmin && !roomData.isOwnerOnline && !isAlwaysOnline && roomId !== "testroom") return;

						const row = document.createElement("div");
						row.style.display = "flex";
						row.style.justifyContent = "space-between";
						row.style.alignItems = "center";
						row.style.padding = "8px";
						row.style.borderBottom = "1px solid #444";

						// NIEUW: Ster icoon voor favorieten
						const starIcon = document.createElement("img");
						const isStarred = starredRooms.includes(roomId);
						starIcon.src = isStarred ? "icons/star_active.png" : "icons/star.png";
						starIcon.style.width = "16px";
						starIcon.style.height = "16px";
						starIcon.style.cursor = "pointer";
						starIcon.style.marginRight = "8px";
						starIcon.title = isStarred ? "Verwijder uit favorieten" : "Markeer als favoriet";
						starIcon.onclick = (e) => {
							e.stopPropagation(); // Voorkom dat we de kamer joinen
							const newStarred = isStarred ? starredRooms.filter((id) => id !== roomId) : [...starredRooms, roomId];
							localStorage.setItem("habboCloneStarredRooms", JSON.stringify(newStarred));
							socket.emit("getRooms"); // Ververs de lijst direct
						};

						const name = document.createElement("span");
						name.textContent = roomId;
						name.style.cursor = "pointer";
						name.style.flexGrow = "1";
						name.onclick = () => {
							if (hasDoorbell) {
								if (isWaitingForDoorbell) {
									showNotification("Je hebt al aangebeld, even geduld...");
									return;
								}
								socket.emit("ringDoorbell", roomId);
								isWaitingForDoorbell = true;
								showNotification("Aangebeld... wachten op antwoord.");
							} else {
								if (playerCount >= maxPlayers) {
									showNotification("Kamer is vol!", "icons/player.png");
									return;
								}
								window.location.search = `?room=${roomId}`;
							}
						};

						if (roomId === currentRoom) {
							name.style.color = "#7bff00";
						}

						const playerCountDiv = document.createElement("div");
						playerCountDiv.style.display = "flex";
						playerCountDiv.style.alignItems = "center";
						playerCountDiv.style.color = "#aaa";

						// Helper voor vaste slots
						const createSlot = (src, title) => {
							const slot = document.createElement("div");
							slot.style.width = "15px"; // Vaste breedte
							slot.style.display = "flex";
							slot.style.justifyContent = "center";
							if (src) {
								const img = document.createElement("img");
								img.src = src;
								img.style.width = "12px";
								img.style.height = "12px";
								if (title) img.title = title;
								slot.appendChild(img);
							}
							return slot;
						};

						// Slot 1: No Smoking
						playerCountDiv.appendChild(createSlot(roomData.noSmoking ? "icons/verboden_active.png" : null, "Roken niet toegestaan"));

						// Slot 2: Heart
						playerCountDiv.appendChild(createSlot(roomData.friendCount > 0 ? "icons/heart.png" : null, "Vrienden"));

						// Slot 3: Bell
						const bellSlot = createSlot(hasDoorbell ? "icons/bel.png" : null, "Deurbel");
						bellSlot.style.marginRight = "8px";
						playerCountDiv.appendChild(bellSlot);

						// Klikken op poppetje opent spelerslijst van die kamer
						const playerSlot = createSlot("icons/player.png", "Bekijk spelers");
						const playerIcon = playerSlot.querySelector("img");
						playerIcon.style.cursor = "pointer";
						playerIcon.onmouseover = () => {
							playerIcon.src = "icons/player_active.png";
						};
						playerIcon.onmouseout = () => {
							playerIcon.src = "icons/player.png";
						};
						playerIcon.onclick = () => {
							const roomPlayersWindow = document.getElementById("roomPlayersWindow");
							roomPlayersWindow.style.display = "flex";
							bringToFront(roomPlayersWindow);
							// Vraag spelers op voor deze kamer
							socket.emit("getRoomPlayers", roomId);
						};
						playerCountDiv.appendChild(playerSlot);

						const countSpan = document.createElement("span");
						countSpan.textContent = `${playerCount}/${maxPlayers}`;
						countSpan.style.width = "35px"; // Vaste breedte
						countSpan.style.textAlign = "right";
						playerCountDiv.appendChild(countSpan);

						row.appendChild(starIcon); // Voeg ster toe
						row.appendChild(name);
						row.appendChild(playerCountDiv);
						roomsContent.appendChild(row);
					});
				}
			}
		});

		// Her-sorteer wanneer de optie verandert
		document.getElementById("roomSortSelect").addEventListener("change", () => {
			socket.emit("getRooms");
		});

		socket.on("roomDeleted", (deletedId) => {
			showNotification(`Kamer "${deletedId}" verwijderd.`);
			// Ververs de lijst
			socket.emit("getRooms");
			// Als we in die kamer zaten, ga naar testroom
			const currentRoom = new URLSearchParams(window.location.search).get("room") || "testroom";
			if (currentRoom === deletedId) {
				window.location.search = "?room=atrium";
			}
		});

		socket.on("roomAlwaysOnlineToggled", () => {
			if (document.getElementById("roomCategoryView").style.display === "block") {
				socket.emit("getRooms");
			}
		});

		socket.on("roomAllowBuildingToggled", () => {
			if (document.getElementById("roomCategoryView").style.display === "block") {
				socket.emit("getRooms");
			}
		});

		socket.on("roomNoSmokingToggled", () => {
			if (document.getElementById("roomCategoryView").style.display === "block") {
				socket.emit("getRooms");
			}
		});

		socket.on("roomIsOutsideToggled", () => {
			if (document.getElementById("roomCategoryView").style.display === "block") {
				socket.emit("getRooms");
			}
		});

		socket.on("roomRenamed", (data) => {
			showNotification(`Kamer "${data.oldId}" is nu "${data.newId}".`);
			// Ververs de admin lijst als die open is
			if (document.getElementById("roomCategoryView").style.display === "block") {
				socket.emit("getRooms");
			}
			// Ververs de speler lijst als die open is
			if (document.getElementById("roomsWindow").style.display === "flex") {
				socket.emit("getRooms");
			}

			// Als we in de hernoemde kamer zaten, laad de pagina opnieuw met de nieuwe URL
			const currentRoom = new URLSearchParams(window.location.search).get("room") || "testroom";
			if (currentRoom === data.oldId) {
				window.location.search = `?room=${data.newId}`;
			}
		});

		socket.on("renameError", (message) => alert(`Fout bij hernoemen: ${message}`));

		// NIEUW: Real-time status update
		socket.on("realTimeStatus", (isActive) => {
			const toggle = document.getElementById("adminRealTimeToggle");
			if (toggle) {
				toggle.dataset.active = isActive ? "true" : "false";
				toggle.src = isActive ? "icons/groen.png" : "icons/rood.png";
			}
		});

		// NIEUW: Ontvang spelerslijst van een kamer
		socket.on("roomPlayersList", (data) => {
			// Update header titel
			const headerTitle = document.querySelector("#roomPlayersHeader span");
			if (headerTitle) {
				headerTitle.textContent = `Alumni in ${data.roomId}`;
			}

			const content = document.getElementById("roomPlayersContent");
			content.innerHTML = "";

			if (data.players.length === 0) {
				content.innerHTML = '<div style="text-align:center; color:#aaa; margin-top:20px;">Geen spelers in deze kamer.</div>';
				return;
			}

			const currentRoomId = new URLSearchParams(window.location.search).get("room") || "testroom";
			const isCurrentRoom = data.roomId === currentRoomId;

			data.players.forEach((p) => {
				const row = document.createElement("div");
				row.style.display = "flex";
				row.style.justifyContent = "space-between";
				row.style.alignItems = "center";
				row.style.padding = "8px 0";
				row.style.borderBottom = "1px solid #333";

				const name = document.createElement("span");
				name.textContent = p.name;

				// Heart Icon
				const isAlreadyFriend = myFriends.some((friend) => friend.userId === p.userId);
				const heartBtn = document.createElement("img");
				heartBtn.src = isAlreadyFriend ? "icons/heart_active.png" : "icons/heart.png";
				heartBtn.style.width = "20px";
				heartBtn.style.height = "20px";
				heartBtn.title = isAlreadyFriend ? "Vrienden" : "Vriend toevoegen";

				if (!isAlreadyFriend && p.id !== socket.id) {
					// Niet jezelf en geen vriend
					heartBtn.style.cursor = "pointer";
					heartBtn.onclick = () => {
						showConfirmation({
							message: `Wil je een vriendschapsverzoek sturen naar ${p.name}?`,
							icon: "icons/heart.png",
							onConfirm: () => socket.emit("sendFriendRequest", { targetId: p.id }),
						});
					};
				}

				// Kick knop logica:
				// 1. Als kamer privé is (ownerId bestaat): Alleen eigenaar ziet knop.
				// 2. Als kamer publiek is (geen ownerId): Iedereen ziet knop (start vote).
				// 3. Je moet wel in die kamer zijn om te kicken/voten.
				const canKick = isCurrentRoom && ((data.ownerId && data.ownerId === myUserId) || !data.ownerId);

				if (canKick && p.id !== socket.id) {
					const kickBtn = document.createElement("img");
					kickBtn.src = "icons/kick.png";
					kickBtn.style.width = "20px";
					kickBtn.style.height = "20px";
					kickBtn.style.cursor = "pointer";
					kickBtn.title = data.ownerId ? "Kicken" : "Start kick stemming";

					kickBtn.onclick = () => {
						const msg = data.ownerId ? `Wil je ${p.name} kicken?` : `Wil je een stemming starten om ${p.name} te kicken?`;
						showConfirmation({
							message: msg,
							icon: "icons/kick.png",
							onConfirm: () => socket.emit("kickPlayer", { targetId: p.id }),
						});
					};

					// Voeg kick knop toe aan row (naast heart of ipv heart als we dat willen, hier ernaast)
					// We maken een container voor acties
					const actionsDiv = document.createElement("div");
					actionsDiv.style.display = "flex";
					actionsDiv.style.alignItems = "center";
					actionsDiv.style.gap = "10px";

					actionsDiv.appendChild(kickBtn);
					if (p.id !== socket.id) actionsDiv.appendChild(heartBtn);

					row.appendChild(name);
					row.appendChild(actionsDiv);
				} else {
					row.appendChild(name);
					if (p.id !== socket.id) row.appendChild(heartBtn);
				}

				content.appendChild(row);
			});
		});
	} catch (e) {
		console.log("Geen backend gedetecteerd, singleplayer modus.");
	}

	// High DPI setup
	const dpr = window.devicePixelRatio || 1;
	canvas.width = window.innerWidth * dpr;
	canvas.height = window.innerHeight * dpr;
	canvas.style.width = window.innerWidth + "px";
	canvas.style.height = window.innerHeight + "px";
	ctx.imageSmoothingEnabled = false; // Zorgt voor scherpe pixel-art (geen wazige randjes bij zoomen)

	const MAX_CHARS = 80;
	const charCounter = document.getElementById("charCounter");

	const urlParams = new URLSearchParams(window.location.search);
	const sizeParam = urlParams.get("size");

	let tileW = 64;
	let tileH = 32;
	let mapW = 25;
	let mapH = 25;

	if (sizeParam) {
		if (sizeParam.includes("x")) {
			const parts = sizeParam.split("x");
			const w = parseInt(parts[0]);
			const h = parseInt(parts[1]);
			if (!isNaN(w) && !isNaN(h)) {
				mapW = w;
				mapH = h;
			}
		} else {
			const newSize = parseInt(sizeParam);
			if (!isNaN(newSize) && [5, 10, 15, 20, 30].includes(newSize)) {
				mapW = newSize;
				mapH = newSize;
			}
		}
	}

	// Snelheid speler FPS Hz
	let lastLogicTime = Date.now(); // NIEUW: Voor de logic loop

	// Speler
	const ball = { x: 0.5, y: 0.5 };
	let hopOffset = 0;

	// Jump variables
	let jumpProgress = 0;
	let jumping = false;
	let jumpStart = { x: 0, y: 0 };
	let jumpEnd = { x: 0, y: 0 };
	const jumpHeight = 12;

	// Hover
	let hoverCell = null;

	// Click-to-walk
	let path = [];
	let highlightedPath = []; // Voor het tekenen van het volledige pad

	// Zoom
	const zoomLevels = [0.8, 0.9, 1.0, 1.2, 1.4, 1.6, 1.8]; // Fijnere zoom-stappen
	let currentZoomIndex = 2; // Start op neutraal niveau (1.0)
	let scale = zoomLevels[currentZoomIndex];

	// Camera
	let camX = 0;
	let camY = 0;
	let mouseWorldX = 0; // NIEUW: Globale muis wereldcoördinaten
	let mouseWorldY = 0; // NIEUW: Globale muis wereldcoördinaten

	// Drag-camera
	let isCameraDragging = false; // Nieuwe variabele voor camera slepen
	let isObjectDragging = false; // Nieuwe variabele voor object slepen
	let isItemDragging = false; // NIEUW: Variabele voor het slepen van items
	let isDraggingFromInventory = false; // NIEUW: Houdt bij of we vanuit de inventaris slepen
	let isDraggingFromShop = false; // NIEUW: Houdt bij of we vanuit de winkel slepen
	let isDraggingFromVicinity = false; // NIEUW: Houdt bij of we vanuit de omgeving slepen
	let isDraggingFromContainer = false; // NIEUW: Houdt bij of we vanuit een container slepen
	let isRearrangingInventory = false; // NIEUW: Voor het verplaatsen binnen de inventaris
	let isRearrangingContainer = false; // NIEUW: Voor het verplaatsen binnen de container
	let activeInventoryItem = null; // NIEUW: Het item dat we binnen de inventaris verplaatsen
	let activePouchItem = null; // For dragging items within a pouch
	let activeContainerItem = null; // NIEUW: Het item dat we binnen de container verplaatsen
	let activeInventoryDiv = null; // The DOM element being rearranged
	let inventoryDragOffset = { x: 0, y: 0 }; // NIEUW: Offset voor slepen in inventaris
	let containerDragOffset = { x: 0, y: 0 }; // NIEUW: Offset voor slepen in container
	let pickupTimer = null; // NIEUW: Timer voor vertraagd oppakken
	let pendingPickup = null; // NIEUW: Data voor vertraagd oppakken
	let dragStart = { x: 0, y: 0 };
	let camStart = { x: 0, y: 0 };

	// Smooth center
	let camTargetX = 0;
	let camTargetY = 0;
	let camSmooth = false;

	// Bouwmodus
	let highestZ = 21; // Startwaarde voor z-index management
	let rainParticles = []; // Voor weer effect

	// Wall settings
	let globalWallHeight = 150;
	let globalGateHeight = 90; // Hoogte van de poort doorgang
	let globalWallThickness = 0.25;

	// Puddles & Splashes
	let tilePuddles = {};
	let tileSnow = {}; // NIEUW: Sneeuwlaag data
	let activeSplashes = [];
	let activeMarks = []; // NIEUW: Zwarte strepen van markers
	let lastMarkerPos = null; // NIEUW: Voor interpolatie van marker lijnen
	let markerColor = "#000000"; // NIEUW: Huidige marker kleur
	let isMarkerMode = false; // NIEUW: Marker modus vlag
	let markerTool = "draw"; // NIEUW: 'draw' of 'erase'
	let markerSize = 2; // NIEUW: Dikte van de marker/gum
	let undoStack = []; // NIEUW: Stack voor undo acties
	let currentStroke = []; // NIEUW: Huidige tekenactie

	// Helper voor deterministische random (voor consistente plassen)
	function randomDeterministic(x, y) {
		return Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
	}

	function bringToFront(element) {
		// Reset z-index van alle vensters naar een basiswaarde
		document.getElementById("buildMenu").style.zIndex = 20;
		document.getElementById("pouchWindow").style.zIndex = 20;
		document.getElementById("chatLog").style.zIndex = 20;
		document.getElementById("inventory").style.zIndex = 20;
		document.getElementById("vicinityWindow").style.zIndex = 20;
		document.getElementById("shopWindow").style.zIndex = 20;
		document.getElementById("containerWindow").style.zIndex = 20;
		document.getElementById("roomsWindow").style.zIndex = 20;
		document.getElementById("myRoomWindow").style.zIndex = 20;
		document.getElementById("roomPlayersWindow").style.zIndex = 20;
		document.getElementById("friendsWindow").style.zIndex = 20;
		document.getElementById("markerMenu").style.zIndex = 20;
		document.getElementById("paperWindow").style.zIndex = 20;
		document.getElementById("newProjectWindow").style.zIndex = 20;
		// Plaats het geklikte element op de voorgrond
		element.style.zIndex = highestZ;
	}

	function closeSecondaryWindows() {
		document.getElementById("chatLog").style.display = "none";
		document.getElementById("inventory").style.display = "none";
		document.getElementById("vicinityWindow").style.display = "none";
		document.getElementById("pouchWindow").style.display = "none";
		document.getElementById("shopWindow").style.display = "none";
		document.getElementById("containerWindow").style.display = "none";
		document.getElementById("roomsWindow").style.display = "none";
		document.getElementById("myRoomWindow").style.display = "none";
		document.getElementById("roomPlayersWindow").style.display = "none";
		document.getElementById("friendsWindow").style.display = "none";
		document.getElementById("markerMenu").style.display = "none";
		document.getElementById("paperWindow").style.display = "none";
		document.getElementById("newProjectWindow").style.display = "none";
	}

	function closeAllWindows() {
		closeSecondaryWindows();
		if (isBuildMode) {
			// Gebruik de bestaande klik-logica om de bouwmodus correct af te sluiten en op te ruimen
			buildBtn.click();
		}
	}

	let isBuildMode = false;
	let selectedBuildObject = null;
	let isBuildObjectFlipped = false; // Voor het spiegelen van objecten
	let editingObject = null; // NIEUW: Houdt bij welk object we bewerken
	let buildTool = "place"; // 'place', 'move', 'delete'
	let showTileNumbers = false; // Toggle voor tegelnummers
	let movingObject = null; // Object dat wordt verplaatst

	let selectedColor = "#ff0000"; // Default kleur
	let windowStatesBeforeDrag = null; // Onthoudt welke vensters open waren
	let draggedObject = null; // Voor het verslepen van 'moveable' objecten buiten bouwmodus
	let draggedItem = null; // NIEUW: Item dat wordt versleept
	let draggedItemOriginalPos = null; // NIEUW: Originele positie van het versleepte item
	let dragImageElement = null; // NIEUW: DOM element voor visuele weergave tijdens slepen
	let draggedObjectOriginalPos = null;
	let camOriginalPos = null; // Voor het resetten van de camera na het slepen van een object

	let activeObjectSubCategory = "objects"; // Start met 'objects' geselecteerd
	let activeMenuContext = "player"; // 'player' or 'admin'
	let activeBuildCategory = "objecten"; // 'objecten', 'kleur', etc.
	let colorTool = "brush"; // 'brush', 'bucket'

	let tileColors = {}; // Slaat de aangepaste tegelkleuren op
	let wallColors = {}; // Slaat de muurkleuren op per segment, bv: { 'top_5': '#ff0000' }
	let wallObjects = []; // Slaat geplaatste muurobjecten op, bv: { wallId: 'top_5', name: 'Muurdecoratie', flipped: false }

	let hoverTarget = null; // Houdt bij wat er gehoverd wordt: { type: 'tile'/'wall', id: 'x,y'/'top'/'left' }
	let activeInteractionButton = null; // NIEUW: Voor klikbare interacties

	// Object image
	const objectImg = new Image();
	objectImg.src = "templates/object_template.png"; // 64x64 symmetrisch
	const objectImg96 = new Image();
	objectImg96.src = "templates/object_template_96.png"; // 64x96 symmetrisch
	const objectImg96B = new Image();
	objectImg96B.src = "templates/object_template_96_B.png"; // 1 hoog, 2 breed
	const moveableObjectImg = new Image();
	moveableObjectImg.src = "templates/object_moveable_template.png";
	const moveableObjectImg96B = new Image();
	moveableObjectImg96B.src = "templates/object_moveable_template_96_B.png";
	const kraanImg = new Image();
	kraanImg.src = "templates/kraan_template.png";
	const kraanImg96 = new Image();
	kraanImg96.src = "templates/kraan_template_96.png";
	const wallItemImg = new Image();
	wallItemImg.src = "templates/wall_template.png";
	const wallItem2Img = new Image(); // NIEUW
	wallItem2Img.src = "templates/wall_2_template.png"; // NIEUW
	const wallFreeImg = new Image(); // NIEUW
	wallFreeImg.src = "templates/wall_free_template.png"; // NIEUW
	const wallFree2Img = new Image(); // NIEUW
	wallFree2Img.src = "templates/wall_2_free_template.png"; // NIEUW
	const floorImg = new Image();
	floorImg.src = "templates/floor_template.png";

	const pongImg = new Image();
	pongImg.src = "objects/pong.png";
	const pongPromptImg = new Image();
	pongPromptImg.src = "prompts/pong.png";
	const druppelPromptImg = new Image();
	druppelPromptImg.src = "prompts/druppel.png";
	const shopPromptImg = new Image();
	shopPromptImg.src = "prompts/winkel.png";
	const winkelImg = new Image();
	winkelImg.src = "templates/winkel_template_96.png";
	const winkelImg96B = new Image();
	winkelImg96B.src = "templates/winkel_template_96_B.png";
	const containerImg = new Image();
	containerImg.src = "templates/container_template.png";
	const containerPromptImg = new Image();
	containerPromptImg.src = "prompts/container.png";
	const trashPromptImg = new Image();
	trashPromptImg.src = "prompts/trash.png";
	const containerImg96 = new Image();
	containerImg96.src = "templates/container_template_96.png";
	const containerImg96B = new Image();
	containerImg96B.src = "templates/container_template_96_B.png";
	const trashImg = new Image();
	trashImg.src = "templates/trash_template.png";
	const trashImg96B = new Image();
	trashImg96B.src = "templates/trash_template_96_B.png";

	// Nieuwe afbeelding voor oppakbare items
	const itemImg = new Image();
	itemImg.src = "items/templates/item_block.png"; // Zorg ervoor dat dit bestand bestaat

	const itemRoundImg = new Image();
	itemRoundImg.src = "items/templates/item_round.png"; // De nieuwe ronde afbeelding

	const currencyItemImg = new Image();
	currencyItemImg.src = "items/templates/currency_item.png";

	const currencyItemBigImg = new Image();
	currencyItemBigImg.src = "items/templates/currency_item_big.png";

	const itemStickImg = new Image();
	itemStickImg.src = "items/templates/item_stick.png";

	const itemContainerImg = new Image();
	itemContainerImg.src = "items/templates/item_container.png";

	const batjeRoodImg = new Image();
	batjeRoodImg.src = "items/batje_rood.png";

	const batjeZwartImg = new Image();
	batjeZwartImg.src = "items/batje_zwart.png";

	const sigarettenContainerImg = new Image();
	sigarettenContainerImg.src = "items/sigaretten_container.png";

	const sigaretStickImg = new Image();
	sigaretStickImg.src = "items/sigaret_stick.png";

	const sigaretHalfStickImg = new Image(); // NIEUW: Halve sigaret afbeelding
	sigaretHalfStickImg.src = "items/sigaret_half.png";

	const aanstekerStickImg = new Image();
	aanstekerStickImg.src = "items/aansteker_stick.png";

	const sigaretHalfImg = new Image();
	sigaretHalfImg.src = "items/sigaret_half.png";

	const peukStickImg = new Image();
	peukStickImg.src = "items/peuk_stick.png";

	const bottleFullImg = new Image();
	bottleFullImg.src = "items/bottle_W_full.png";

	const bottleEmptyImg = new Image();
	bottleEmptyImg.src = "items/bottle_W_empty.png";

	const bottleHalfImg = new Image();
	bottleHalfImg.src = "items/bottle_W_50.png";

	// Helper om server data om te zetten naar client item (met plaatje)
	function createItemFromData(data) {
		let img = itemImg;
		if (data.type === "ball") img = itemRoundImg;
		else if (data.type === "currency") img = currencyItemImg;
		else if (data.type === "currency_big") img = currencyItemBigImg;
		else if (data.type === "stick") img = itemStickImg;
		else if (data.type === "pouch") img = itemContainerImg;
		else if (data.type === "bat_red") img = batjeRoodImg;
		else if (data.type === "bat_black") img = batjeZwartImg;
		else if (data.type === "sigaretten_container") img = sigarettenContainerImg;
		else if (data.type === "sigaret") img = sigaretStickImg;
		else if (data.type === "aansteker") img = aanstekerStickImg;
		else if (data.type === "sigaret_half") img = sigaretHalfImg;
		else if (data.type === "peuk") img = peukStickImg;
		else if (data.type === "bottle_full") img = bottleFullImg;
		else if (data.type === "bottle_empty") img = bottleEmptyImg;
		else if (data.type === "bottle_half") img = bottleHalfImg;

		// Recursief hydrateren van items in een pouch
		if (data.items && Array.isArray(data.items)) {
			data.items = data.items.map(createItemFromData);
		}

		return {
			...data,
			ownerId: data.ownerId, // Create copy of ownerId
			image: img,
		};
	}

	// Helper om client item om te zetten naar server data (zonder plaatje)
	function serializeItem(item) {
		let { image, ...data } = item;
		data = { ...data }; // Maak een kopie om het originele object niet te muteren

		// Recursief serialiseren van items in een pouch
		if (data.items && Array.isArray(data.items)) {
			data.items = data.items.map(serializeItem);
		}
		return data;
	}

	// Functie om items naar server te sturen
	function syncItems() {
		if (socket) {
			const serializedItems = items.map(serializeItem);
			socket.emit("updateItems", serializedItems);
		}
	}

	// Array voor oppakbare items (wordt nu gevuld door server)
	const items = [];

	// Array voor items in de inventaris
	const inventoryItems = [];
	let walletBalance = 0.0;
	const shopOutputItems = []; // Items in de uitgiftebak van de winkel
	let highestInventoryZ = 10; // Voor z-index management in inventory
	let highestContainerZ = 10; // Voor z-index management in container
	let transactionFadeTimeout;

	// NIEUW: Persistente data functies (Opslaan & Laden)
	function savePlayerData() {
		// Stuur naar server als we verbonden zijn
		if (socket && myUserId) {
			socket.emit("savePlayerData", {
				userId: myUserId,
				wallet: walletBalance,
				inventory: inventoryItems.map(serializeItem),
			});
		}
		const data = {
			wallet: walletBalance,
			inventory: inventoryItems.map(serializeItem),
		};
		sessionStorage.setItem("habboClonePlayerData", JSON.stringify(data));
	}

	function loadPlayerData() {
		const stored = sessionStorage.getItem("habboClonePlayerData");
		if (stored) {
			try {
				const data = JSON.parse(stored);
				if (typeof data.wallet === "number") {
					walletBalance = data.wallet;
					document.getElementById("wallet").textContent = `€${walletBalance.toFixed(2)}`;
				}
				if (Array.isArray(data.inventory)) {
					inventoryItems.length = 0;
					data.inventory.forEach((itemData) => {
						inventoryItems.push(createItemFromData(itemData));
					});
				}
			} catch (e) {
				console.error("Fout bij laden speler data", e);
			}
		}
	}

	// Laad data direct bij opstarten
	loadPlayerData();

	function addToWallet(amount) {
		walletBalance += amount;
		document.getElementById("wallet").textContent = `€${walletBalance.toFixed(2)}`;

		const feed = document.getElementById("transactionFeed");
		const sign = amount >= 0 ? "+" : "";
		feed.textContent = `${sign}€${amount.toFixed(2)}`;
		feed.style.color = amount >= 0 ? "#7bff00" : "#f44336"; // Groen of Rood

		// Reset animatie
		feed.style.transition = "none";
		feed.style.opacity = "1";

		if (transactionFadeTimeout) clearTimeout(transactionFadeTimeout);

		// Start fade out
		transactionFadeTimeout = setTimeout(() => {
			feed.style.transition = "opacity 2s ease-out";
			feed.style.opacity = "0";
		}, 1000);

		savePlayerData(); // Opslaan bij wijziging van geld
	}

	let notificationTimer = null;
	let notificationFadeTimer = null;

	function clearNotificationTimers() {
		if (notificationTimer) clearTimeout(notificationTimer);
		if (notificationFadeTimer) clearTimeout(notificationFadeTimer);
		notificationTimer = null;
		notificationFadeTimer = null;
	}

	function showNotification(message, iconSrc = null) {
		clearNotificationTimers();
		const notif = document.getElementById("notification");
		notif.style.pointerEvents = "none"; // Default for simple notifications

		let content = message;
		if (iconSrc) {
			content = `
            <div style="display:flex; align-items:center; justify-content:center; gap:10px;">
                <img src="${iconSrc}" style="width:24px; height:24px; image-rendering:pixelated;">
                <span>${message}</span>
            </div>
        `;
		}
		notif.innerHTML = content;
		notif.style.display = "block";
		// Force reflow om transitie te triggeren
		void notif.offsetWidth;
		notif.style.opacity = "1";

		notificationTimer = setTimeout(() => {
			notif.style.opacity = "0";
			notificationFadeTimer = setTimeout(() => {
				notif.style.display = "none";
			}, 500); // Wacht op transitie
		}, 3000);
	}

	// NIEUW: Generieke bevestiging pop-up
	function showConfirmation(options) {
		clearNotificationTimers();
		// options = { message, subMessage, icon, onConfirm, onDeny, confirmText, denyText }
		const notif = document.getElementById("notification");
		notif.style.pointerEvents = "auto";

		const iconHtml = options.icon
			? `<img src="${options.icon}" style="width:16px; height:16px; image-rendering:pixelated; vertical-align:middle; margin-right: 5px;">`
			: "";
		const confirmText = options.confirmText || "Ja";
		const denyText = options.denyText || "Nee";

		notif.innerHTML = `
        <div class="popup-content">
            <div class="popup-header">
                ${iconHtml}
                <span>${options.message}</span>
            </div>
            ${options.subMessage ? `<div class="popup-sub">${options.subMessage}</div>` : ""}
            <div class="popup-actions">
                <button id="confirmYes" class="popup-btn confirm">${confirmText}</button>
                <button id="confirmNo" class="popup-btn deny">${denyText}</button>
            </div>
        </div>
    `;
		notif.style.display = "block";
		notif.style.opacity = "1";

		const close = () => {
			notif.style.display = "none";
			notif.style.pointerEvents = "none";
		};

		document.getElementById("confirmYes").onclick = () => {
			if (options.onConfirm) options.onConfirm();
			close();
		};
		document.getElementById("confirmNo").onclick = () => {
			if (options.onDeny) options.onDeny();
			close();
		};
	}

	// NIEUW: Generieke melding pop-up (één knop)
	function showAlert(options) {
		clearNotificationTimers();
		const notif = document.getElementById("notification");
		notif.style.pointerEvents = "auto";

		const iconHtml = options.icon
			? `<img src="${options.icon}" style="width:16px; height:16px; image-rendering:pixelated; vertical-align:middle; margin-right: 5px;">`
			: "";

		notif.innerHTML = `
        <div class="popup-content">
            <div class="popup-header">
                ${iconHtml}
                <span>${options.message}</span>
            </div>
            ${options.subMessage ? `<div class="popup-sub">${options.subMessage}</div>` : ""}
            <div class="popup-actions">
                <button id="alertOk" class="popup-btn neutral">Oké</button>
            </div>
        </div>
    `;
		notif.style.display = "block";
		notif.style.opacity = "1";

		document.getElementById("alertOk").onclick = () => {
			if (options.onOk) options.onOk();
			notif.style.display = "none";
			notif.style.pointerEvents = "none";
		};
	}

	// NIEUW: Generieke input prompt (voor hernoemen etc.)
	function showInputPrompt(options) {
		clearNotificationTimers();
		const notif = document.getElementById("notification");
		notif.style.pointerEvents = "auto";

		notif.innerHTML = `
        <div class="popup-content">
            <div class="popup-header">${options.message}</div>
            <input type="text" id="promptInput" value="${options.defaultValue || ""}" class="popup-input">
            <div class="popup-actions">
                <button id="promptOk" class="popup-btn confirm">Bevestigen</button>
                <button id="promptCancel" class="popup-btn deny">Annuleren</button>
            </div>
        </div>
    `;
		notif.style.display = "block";
		notif.style.opacity = "1";

		const input = document.getElementById("promptInput");
		input.focus();
		input.select();

		const close = () => {
			notif.style.display = "none";
			notif.style.pointerEvents = "none";
		};

		document.getElementById("promptOk").onclick = () => {
			if (options.onConfirm) options.onConfirm(input.value);
			close();
		};
		document.getElementById("promptCancel").onclick = () => {
			close();
		};

		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				if (options.onConfirm) options.onConfirm(input.value);
				close();
			}
		});
	}

	// Standaard objecten voor de 'testroom' als deze leeg is op de server.
	const defaultTestRoomObjects = [
		{ x: 5, y: 5, height: 1, width: 2, depth: 1, flipped: false, name: "Tafel" },
		{ x: 5, y: 8, height: 1, width: 2, depth: 1, flipped: true, name: "Tafel" },
		{ x: 10, y: 5, height: 1, width: 2, depth: 1, flipped: false, name: "Pong" },
		{ x: 10, y: 10, height: 2, flipped: false, name: "Hoge Blok" },
		{ x: 15, y: 8, height: 1, flipped: false, name: "Blok" },
		{ x: 3, y: 18, height: 2, flipped: true, name: "Hoge Blok" },
		{ x: 20, y: 20, height: 1, flipped: false, name: "Blok" },
		{ x: 18, y: 3, height: 2, flipped: false, name: "Hoge Blok" },
		{ x: 8, y: 12, height: 1, flipped: false, moveable: true, name: "Verplaatsbaar Blok" },
		{ x: 16, y: 5, height: 2, flipped: false, name: "Winkel" },
		{ x: 19, y: 5, height: 2, flipped: true, name: "Winkel" },
		{ x: 12, y: 5, height: 1, flipped: false, name: "Container" },
		{ x: 12, y: 8, height: 2, flipped: false, name: "Grote Container" },
		{ x: 14, y: 8, height: 1, width: 2, depth: 1, flipped: false, name: "Brede Container" },
		{ x: 8, y: 8, height: 1, flipped: false, name: "Prullenbak" },
	];

	// Objecten array - wordt gevuld door de server.
	const objects = [];

	let isSmoking = false;
	let smokeInterval = null;
	let currentSmokingItemType = null;
	let isDrinking = false;
	let drinkInterval = null;
	let currentDrinkingItemType = null;
	let isFilling = false;
	let fillInterval = null;

	// Helper om te checken of er een aansteker is (ook in pouches)
	function hasLighterInInventory(items) {
		return items.some((i) => {
			if (i.type === "aansteker" || (i.name && i.name.toLowerCase() === "aansteker")) return true;
			if (i.items && Array.isArray(i.items)) {
				return hasLighterInInventory(i.items);
			}
			return false;
		});
	}

	// NIEUW: Functie om een aansteker te vinden en te gebruiken
	function findAndUseLighter(items) {
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (item.type === "aansteker") {
				// Initialiseer 'uses' als het niet bestaat
				if (item.uses === undefined) {
					item.uses = 50; // AANGEPAST: 50 uses default
				}

				if (item.uses > 0) {
					item.uses--; // Verminder gebruik
					if (item.uses <= 0) {
						showNotification("Je aansteker is leeg!");
					}

					savePlayerData(); // Sla wijzigingen op
					renderInventoryItems(); // Her-render om wijziging te tonen
					return true; // Aansteker gevonden en gebruikt
				}
			}

			// Recursief zoeken in pouches
			if (item.items && Array.isArray(item.items)) {
				if (findAndUseLighter(item.items)) {
					// Als gevonden in een sub-pouch, her-render de relevante UI
					if (openPouch) renderPouchItems();
					if (openContainer) renderContainerItems();
					return true;
				}
			}
		}
		return false; // Geen aansteker gevonden
	}

	function smokeCigarette(item) {
		if (isSmoking) {
			showNotification("Je bent al aan het roken!");
			return;
		}

		// NIEUW: Check of roken is toegestaan in deze kamer
		if (currentRoomSettings.noSmoking && !isUserAdmin && !isRoomOwner) {
			showConfirmation({
				message: "Verboden te roken in deze ruimte.",
				subMessage: "Wil je naar buiten?",
				icon: "icons/verboden_active.png",
				confirmText: "Ja",
				denyText: "Nee",
				onConfirm: () => {
					window.location.search = "?room=buiten";
				},
			});
			return;
		}

		// Check of de speler een aansteker heeft en gebruik deze
		if (!findAndUseLighter(inventoryItems)) {
			showNotification("Je hebt geen aansteker!");
			return;
		}

		const cigaretteIndex = inventoryItems.indexOf(item);

		if (cigaretteIndex === -1) return; // Sigaret is niet (meer) in inventory.

		// Verwijder nu pas de sigaret uit de array.
		inventoryItems.splice(cigaretteIndex, 1);

		savePlayerData();
		renderInventoryItems();
		currentSmokingItemType = item.type;
		isSmoking = true;
		ball.smokingStartTime = Date.now(); // NIEUW: Starttijd opslaan voor animatie
		ball.smokingItemType = item.type; // Opslaan welk type we roken
		if (socket) socket.emit("playerMovement", { x: ball.x, y: ball.y, isSmoking: true, smokingItemType: item.type }); // NIEUW: Vertel server wat we roken

		if (typeof sendChatMessage === "function") {
			sendChatMessage("*steekt een sigaret op*");
		}

		// UI Setup
		const barContainer = document.getElementById("statusBarContainer");
		const barFill = document.getElementById("statusBarFill");
		const barText = document.getElementById("statusBarText");

		barContainer.style.display = "block";
		barText.textContent = "Roken";
		barFill.style.width = "0%";

		const duration = item.type === "sigaret_half" ? 5000 : 10000; // 5s voor half, 10s voor heel

		// NIEUW: 10% kans op een opmerking tijdens het roken
		if (Math.random() < 0.1) {
			const randomTime = Math.random() * (duration - 2000) + 1000; // Zeg iets tussen 1s en (duur-1)s
			setTimeout(() => {
				if (isSmoking && currentSmokingItemType === item.type) {
					// Alleen als we nog roken
					const phrases = ["*kuch*", "*paf*", "*zucht*"];
					const phrase = phrases[Math.floor(Math.random() * phrases.length)];
					if (typeof sendChatMessage === "function") sendChatMessage(phrase);
				}
			}, randomTime);
		}

		const startTime = Date.now();
		const intervalTime = 100; // update elke 100ms

		smokeInterval = setInterval(() => {
			const elapsed = Date.now() - startTime;
			const progress = Math.min(100, (elapsed / duration) * 100);
			barFill.style.width = `${progress}%`;

			if (elapsed >= duration) {
				clearInterval(smokeInterval);
				isSmoking = false;
				barContainer.style.display = "none";
				currentSmokingItemType = null;
				if (socket) socket.emit("playerMovement", { x: ball.x, y: ball.y, isSmoking: false, smokingItemType: null }); // NIEUW: Stop roken op server

				// NIEUW: Laat een peuk vallen
				const buttItem = {
					type: "peuk",
					name: "Peuk",
					x: ball.x + (Math.random() * 0.4 - 0.2), // Klein beetje random offset
					y: ball.y + (Math.random() * 0.4 - 0.2),
					z: 20, // Valt van heuphoogte
					rotation: Math.random() * Math.PI * 2, // Willekeurige rotatie
					mass: 0.01,
					canTopple: true,
					vx: 0,
					vy: 0,
					vz: 0,
					vr: 0, // Initialiseer physics variabelen
				};
				// Stuur naar server zodat iedereen hem ziet vallen
				if (socket) socket.emit("placeItem", buttItem);
			}
		}, intervalTime);
	}

	function drinkBottle(item) {
		if (isSmoking || isDrinking || document.getElementById("statusBarContainer").style.display === "block") {
			showNotification("Je bent al bezig met iets!");
			return;
		}

		const index = inventoryItems.indexOf(item);
		if (index === -1) return;

		// Verwijder volle fles
		inventoryItems.splice(index, 1);
		savePlayerData();
		renderInventoryItems();

		currentDrinkingItemType = item.type;
		ball.drinkingStartTime = Date.now();
		ball.drinkingItemType = item.type;
		if (socket) socket.emit("playerMovement", { x: ball.x, y: ball.y, isDrinking: true, drinkingItemType: item.type });

		// UI Setup
		const barContainer = document.getElementById("statusBarContainer");
		const barFill = document.getElementById("statusBarFill");
		const barText = document.getElementById("statusBarText");

		barContainer.style.display = "block";
		barText.textContent = "Drinken";
		barFill.style.width = "0%";

		isDrinking = true;
		const startTime = Date.now(); // NIEUW: Gebruik tijdstempel
		// Volle fles 4 sec, halve fles 2 sec
		const duration = item.type === "bottle_full" ? 4000 : 2000;
		const intervalTime = 100;

		drinkInterval = setInterval(() => {
			const elapsed = Date.now() - startTime;
			const progress = Math.min(100, (elapsed / duration) * 100);
			barFill.style.width = `${progress}%`;

			if (elapsed >= duration) {
				clearInterval(drinkInterval);
				isDrinking = false;
				currentDrinkingItemType = null;
				if (socket) socket.emit("playerMovement", { x: ball.x, y: ball.y, isDrinking: false, drinkingItemType: null });
				barContainer.style.display = "none";

				const emptyBottle = {
					type: "bottle_empty",
					name: "Leeg flesje",
					mass: 0.8,
					image: bottleEmptyImg,
					vx: 0,
					vy: 0,
					vz: 0,
					rotation: 0,
					vr: 0,
					invX: Math.floor(Math.random() * 250) + 20,
					invY: Math.floor(Math.random() * 200) + 20,
				};
				inventoryItems.push(emptyBottle);
				savePlayerData();
				renderInventoryItems();
			}
		}, intervalTime);
	}

	function fillBottle(item) {
		if (isSmoking || isDrinking || isFilling || document.getElementById("statusBarContainer").style.display === "block") {
			showNotification("Je bent al bezig met iets!");
			return;
		}

		const index = inventoryItems.indexOf(item);
		if (index === -1) return;

		// Verwijder lege fles
		inventoryItems.splice(index, 1);
		savePlayerData();
		renderInventoryItems();

		// UI Setup
		const barContainer = document.getElementById("statusBarContainer");
		const barFill = document.getElementById("statusBarFill");
		const barText = document.getElementById("statusBarText");

		barContainer.style.display = "block";
		barText.textContent = "Fles vullen";
		barFill.style.width = "0%";

		isFilling = true;
		const startTime = Date.now();
		const duration = item.type === "bottle_half" ? 1500 : 3000;
		const intervalTime = 100;

		fillInterval = setInterval(() => {
			const elapsed = Date.now() - startTime;
			const progress = Math.min(100, (elapsed / duration) * 100);
			barFill.style.width = `${progress}%`;

			if (elapsed >= duration) {
				clearInterval(fillInterval);
				isFilling = false;
				barContainer.style.display = "none";

				const fullBottle = {
					type: "bottle_full",
					name: "Flesje water",
					mass: 1.2,
					image: bottleFullImg,
					vx: 0,
					vy: 0,
					vz: 0,
					rotation: 0,
					vr: 0,
					invX: item.invX, // Probeer op dezelfde plek terug te zetten
					invY: item.invY,
				};
				inventoryItems.push(fullBottle);
				savePlayerData();
				renderInventoryItems();
				showNotification("Fles gevuld!");
			}
		}, intervalTime);
	}

	function interruptAction() {
		if (isSmoking) {
			clearInterval(smokeInterval);
			isSmoking = false;
			if (socket) socket.emit("playerMovement", { x: ball.x, y: ball.y, isSmoking: false, smokingItemType: null });
			document.getElementById("statusBarContainer").style.display = "none";

			if (currentSmokingItemType === "sigaret") {
				const halfItem = {
					type: "sigaret_half",
					name: "Halve Sigaret",
					mass: 0.05,
					canTopple: true,
					image: sigaretHalfImg,
					vx: 0,
					vy: 0,
					vz: 0,
					rotation: 0,
					vr: 0,
					invX: Math.floor(Math.random() * 250) + 20,
					invY: Math.floor(Math.random() * 200) + 20,
				};

				inventoryItems.push(halfItem);
				savePlayerData();
				renderInventoryItems();
				showNotification("Roken onderbroken");
			} else if (currentSmokingItemType === "sigaret_half") {
				const buttItem = {
					type: "peuk",
					name: "Peuk",
					x: ball.x + (Math.random() * 0.4 - 0.2),
					y: ball.y + (Math.random() * 0.4 - 0.2),
					z: 20,
					rotation: Math.random() * Math.PI * 2,
					mass: 0.01,
					canTopple: true,
					vx: 0,
					vy: 0,
					vz: 0,
					vr: 0,
				};
				if (socket) socket.emit("placeItem", buttItem);
				showNotification("Roken onderbroken");
			}

			currentSmokingItemType = null;
		}
		if (isDrinking) {
			clearInterval(drinkInterval);
			isDrinking = false;
			document.getElementById("statusBarContainer").style.display = "none";
			currentDrinkingItemType = null;
			if (socket) socket.emit("playerMovement", { x: ball.x, y: ball.y, isDrinking: false, drinkingItemType: null });

			// Als onderbroken, krijg je een halfvol flesje terug (of het nou vol of half was)
			const halfBottle = {
				type: "bottle_half",
				name: "Halfvol flesje",
				mass: 1.0,
				image: bottleHalfImg,
				vx: 0,
				vy: 0,
				vz: 0,
				rotation: 0,
				vr: 0,
				invX: Math.floor(Math.random() * 250) + 20,
				invY: Math.floor(Math.random() * 200) + 20,
			};
			inventoryItems.push(halfBottle);
			savePlayerData();
			renderInventoryItems();
			showNotification("Drinken onderbroken");
		}
		if (isFilling) {
			clearInterval(fillInterval);
			isFilling = false;
			document.getElementById("statusBarContainer").style.display = "none";

			const halfBottle = {
				type: "bottle_half",
				name: "Halfvol flesje",
				mass: 1.0,
				image: bottleHalfImg,
				vx: 0,
				vy: 0,
				vz: 0,
				rotation: 0,
				vr: 0,
				invX: Math.floor(Math.random() * 250) + 20,
				invY: Math.floor(Math.random() * 200) + 20,
			};
			inventoryItems.push(halfBottle);
			savePlayerData();
			renderInventoryItems();
			showNotification("Vullen onderbroken");
		}
	}

	function renderInventoryItems() {
		const inventoryContent = document.getElementById("inventoryContent");
		inventoryContent.innerHTML = ""; // Maak de lijst leeg

		inventoryItems.forEach((item, index) => {
			// Self-healing: herstel afbeelding indien nodig
			if (!item.image) {
				const hydrated = createItemFromData(item);
				item.image = hydrated.image;
			}

			const div = document.createElement("div"); // NIEUW: Gebruik item.name voor weergave
			div.className = "inventory-item"; // NIEUW: Gebruik specifieke stijl zonder tekst
			const imgSrc = item.image ? item.image.src : "";

			// Zet de positie (of default naar 0,0 of een grid-achtige startpositie als het nieuw is)
			// Als invX/invY nog niet bestaat, geven we het een plekje op basis van index (simpele grid fallback)
			if (item.invX === undefined) {
				item.invX = (index % 3) * 110 + 20;
				item.invY = Math.floor(index / 3) * 110 + 20;
			}

			div.style.position = "absolute";
			div.style.left = item.invX + "px";
			div.style.top = item.invY + "px";

			div.innerHTML = `<img src="${imgSrc}" alt="Item" title="Sleep naar de kamer">`;

			// NIEUW: Rechtermuisknop menu (Context Menu)
			div.addEventListener("contextmenu", (e) => {
				e.preventDefault();
				e.stopPropagation();
				if (
					item.isPouch ||
					item.type === "pouch" ||
					item.type === "sigaret" ||
					item.type === "sigaret_half" ||
					item.type === "bottle_full" ||
					item.type === "bottle_half"
				) {
					showItemContextMenu(e.clientX, e.clientY, item);
				}
			});

			// Event listener om items vanuit de inventaris te slepen
			div.addEventListener("mousedown", (e) => {
				// Handmatige dubbelklik detectie om conflicten te voorkomen
				const now = Date.now();
				const lastClick = parseFloat(div.dataset.lastClick) || 0;

				if (now - lastClick < 300) {
					// 300ms is een goede drempel
					e.preventDefault();
					e.stopPropagation();

					if (item.isPouch || item.type === "pouch") {
						if (!item.items) {
							item.items = []; // Initialiseer als het niet bestaat
						}
						openContainerWindow(item);
					} else if (item.type === "sigaret" || item.type === "sigaret_half") {
						smokeCigarette(item);
					} else if (item.type === "bottle_full" || item.type === "bottle_half") {
						drinkBottle(item);
					}

					div.dataset.lastClick = 0; // Reset voor volgende klik
					isRearrangingInventory = false; // Zorg dat drag niet start
					activeInventoryItem = null;
					activeInventoryDiv = null;
					return;
				}
				div.dataset.lastClick = now;

				// --- Start van de normale 'enkele klik' / sleep logica ---

				// NIEUW: Breng item naar voorgrond
				div.style.zIndex = ++highestInventoryZ;

				// Update array volgorde zodat dit ook zo blijft bij her-renderen
				const idx = inventoryItems.indexOf(item);
				if (idx > -1) {
					inventoryItems.push(inventoryItems.splice(idx, 1)[0]);
				}

				e.preventDefault();
				if (e.button === 0) {
					// Alleen linkermuisknop
					// Start met verplaatsen BINNEN de inventaris
					isRearrangingInventory = true;
					activeInventoryItem = item;
					activeInventoryDiv = div;

					// Bereken offset zodat het item niet verspringt onder de muis
					const rect = div.getBoundingClientRect();
					inventoryDragOffset = {
						x: e.clientX - rect.left,
						y: e.clientY - rect.top,
					};

					e.stopPropagation(); // Voorkom dat andere kliks (zoals op het menu zelf) afgaan
				}
			});

			inventoryContent.appendChild(div);
		});
	}

	// NIEUW: Logica voor het context menu
	const itemContextMenu = document.getElementById("itemContextMenu");
	const ctxOpenBtn = document.getElementById("ctxOpenBtn");
	const ctxCancelBtn = document.getElementById("ctxCancelBtn");
	let currentCtxItem = null;
	let ctxDynamicButtons = []; // Houdt dynamisch toegevoegde knoppen bij

	function showItemContextMenu(x, y, item) {
		currentCtxItem = item;

		// Verwijder oude dynamische knoppen
		ctxDynamicButtons.forEach((btn) => btn.remove());
		ctxDynamicButtons = [];

		// Verberg standaard knop tijdelijk
		ctxOpenBtn.style.display = "none";

		if (item.type === "sigaret" || item.type === "sigaret_half") {
			ctxOpenBtn.textContent = "Roken";
			ctxOpenBtn.style.display = "block";
		} else if (item.type === "bottle_full" || item.type === "bottle_half") {
			ctxOpenBtn.textContent = "Drinken";
			ctxOpenBtn.style.display = "block";
		} else {
			ctxOpenBtn.textContent = "Openen";
			ctxOpenBtn.style.display = "block";
		}

		itemContextMenu.style.display = "block";
		itemContextMenu.style.left = x + "px";
		itemContextMenu.style.top = y + "px";
	}

	ctxOpenBtn.addEventListener("click", () => {
		if (currentCtxItem) {
			if (currentCtxItem.type === "sigaret" || currentCtxItem.type === "sigaret_half") {
				smokeCigarette(currentCtxItem);
			} else if (currentCtxItem.type === "bottle_full" || currentCtxItem.type === "bottle_half") {
				drinkBottle(currentCtxItem);
			} else {
				if (!currentCtxItem.items) currentCtxItem.items = [];
				openContainerWindow(currentCtxItem);
			}
			itemContextMenu.style.display = "none";
			currentCtxItem = null;
		}
	});

	ctxCancelBtn.addEventListener("click", () => {
		itemContextMenu.style.display = "none";
		currentCtxItem = null;
	});

	window.addEventListener("click", (e) => {
		if (itemContextMenu.style.display === "block" && !e.target.closest("#itemContextMenu")) {
			itemContextMenu.style.display = "none";
			currentCtxItem = null;
		}
	});

	const inventory = document.getElementById("inventory");
	const inventoryBtn = document.getElementById("inventoryBtn");

	inventoryBtn.addEventListener("click", () => {
		inventory.style.display = inventory.style.display === "flex" ? "none" : "flex";
		inventoryBtn.querySelector("img").src = inventory.style.display === "flex" ? "icons/inventory_active.png" : "icons/inventory.png";
		renderInventoryItems(); // Update de inventaris wanneer deze wordt geopend

		if (inventory.style.display === "none") {
			document.getElementById("vicinityWindow").style.display = "none";
			if (vicinityInterval) clearInterval(vicinityInterval);
			document.querySelector("#vicinityBtn img").src = "icons/vicinity.png";
		}
	});

	// Paper knop logica
	const paperBtn = document.getElementById("paperBtn");
	const paperWindow = document.getElementById("paperWindow");
	const closePaperBtn = document.getElementById("closePaperBtn");

	if (paperBtn) {
		paperBtn.addEventListener("click", () => {
			if (paperWindow.style.display === "flex") {
				paperWindow.style.display = "none";
				paperBtn.querySelector("img").src = "icons/paper.png";
			} else {
				closeSecondaryWindows();
				if (isBuildMode) closeBuildAdminMenu();
				paperWindow.style.display = "flex";
				paperBtn.querySelector("img").src = "icons/paper_active.png";
				bringToFront(paperWindow);
			}
		});
	}

	if (closePaperBtn) {
		closePaperBtn.addEventListener("click", () => {
			paperWindow.style.display = "none";
			paperBtn.querySelector("img").src = "icons/paper.png";
		});
	}

	const newProjectWindow = document.getElementById("newProjectWindow");
	const closeNewProjectWindowBtn = document.getElementById("closeNewProjectWindowBtn");

	if (closeNewProjectWindowBtn) {
		closeNewProjectWindowBtn.addEventListener("click", () => {
			newProjectWindow.style.display = "none";
			paperWindow.style.display = "flex";
			bringToFront(paperWindow);
		});
	}

	// Nieuw Project Preview Logica
	const npWidth = document.getElementById("newProjectWidth");
	const npHeight = document.getElementById("newProjectHeight");
	const npOrient = document.getElementById("newProjectOrientation");
	const npBg = document.getElementById("newProjectBackground");
	const npPreview = document.getElementById("projectPreviewCanvas");
	const npDims = document.getElementById("projectPreviewDimensions");
	const npPresets = document.getElementById("newProjectPresets");
	const saveSettingsBtn = document.getElementById("saveProjectSettingsBtn");

	function updateProjectPreview() {
		if (!npWidth || !npHeight || !npPreview) return;

		let w = parseInt(npWidth.value) || 800;
		let h = parseInt(npHeight.value) || 600;
		const bg = npBg.value;

		// Update label
		npDims.textContent = `${w} x ${h} px`;

		// Update preview box aspect ratio
		const maxW = 200;
		const maxH = 300;
		const ratio = w / h;

		let preW, preH;
		if (ratio > 1) {
			// Landscape
			preW = Math.min(maxW, 180);
			preH = preW / ratio;
		} else {
			// Portrait
			preH = Math.min(maxH, 250);
			preW = preH * ratio;
		}

		npPreview.style.width = `${preW}px`;
		npPreview.style.height = `${preH}px`;

		// Update background
		if (bg === "transparent") {
			npPreview.style.background = "conic-gradient(#ccc 0.25turn, white 0.25turn 0.5turn, #ccc 0.5turn 0.75turn, white 0.75turn)";
			npPreview.style.backgroundSize = "10px 10px";
		} else {
			npPreview.style.background = bg;
		}
	}

	if (npWidth && npHeight && npOrient && npBg) {
		[npWidth, npHeight, npBg].forEach((el) => {
			el.addEventListener("input", updateProjectPreview);
			el.addEventListener("change", updateProjectPreview);
		});

		// Specifieke logica voor oriëntatie wissel (draait afmetingen om)
		npOrient.addEventListener("change", () => {
			const w = npWidth.value;
			const h = npHeight.value;
			npWidth.value = h;
			npHeight.value = w;
			updateProjectPreview();
		});

		// Init
		updateProjectPreview();
	}

	// Functies voor voorinstellingen
	function loadProjectPresets() {
		if (!npPresets) return;
		const stored = localStorage.getItem("habboCloneProjectPresets");
		npPresets.innerHTML = '<option value="">-- Selecteer --</option>';
		if (stored) {
			try {
				const presets = JSON.parse(stored);
				Object.keys(presets).forEach((name) => {
					const opt = document.createElement("option");
					opt.value = name;
					opt.textContent = name;
					npPresets.appendChild(opt);
				});
			} catch (e) {}
		}
	}

	if (npPresets) {
		loadProjectPresets();
		npPresets.addEventListener("change", () => {
			const name = npPresets.value;
			if (!name) return;
			const stored = localStorage.getItem("habboCloneProjectPresets");
			if (stored) {
				const presets = JSON.parse(stored);
				const p = presets[name];
				if (p) {
					npWidth.value = p.width;
					npHeight.value = p.height;
					npOrient.value = p.orientation;
					npBg.value = p.background;
					updateProjectPreview();
				}
			}
		});
	}

	if (saveSettingsBtn) {
		saveSettingsBtn.addEventListener("click", () => {
			showInputPrompt({
				message: "Naam voor voorinstelling:",
				onConfirm: (name) => {
					if (!name) return;
					let presets = {};
					try {
						presets = JSON.parse(localStorage.getItem("habboCloneProjectPresets")) || {};
					} catch (e) {}

					presets[name] = {
						width: npWidth.value,
						height: npHeight.value,
						orientation: npOrient.value,
						background: npBg.value,
					};

					localStorage.setItem("habboCloneProjectPresets", JSON.stringify(presets));
					loadProjectPresets();
					npPresets.value = name;
					showNotification(`Voorinstelling "${name}" opgeslagen!`);
				},
			});
		});
	}

	// Project Window Logica
	const createNewProjectConfirmBtn = document.getElementById("createNewProjectConfirmBtn");
	const projectWindow = document.getElementById("projectWindow");
	const closeProjectBtn = document.getElementById("closeProjectBtn");
	const projectTitle = document.getElementById("projectTitle");
	const projectCanvasWrapper = document.getElementById("projectCanvasWrapper");
	const projectWorkspace = document.getElementById("projectWorkspace");

	if (createNewProjectConfirmBtn) {
		createNewProjectConfirmBtn.addEventListener("click", () => {
			const name = document.getElementById("newProjectName").value || "Naamloos";
			const width = parseInt(document.getElementById("newProjectWidth").value) || 800;
			const height = parseInt(document.getElementById("newProjectHeight").value) || 600;
			const bg = document.getElementById("newProjectBackground").value;

			// Sla instellingen op voor de volgende keer
			localStorage.setItem(
				"habboCloneLastProjectSettings",
				JSON.stringify({
					width: width,
					height: height,
					orientation: document.getElementById("newProjectOrientation").value,
					background: bg,
				})
			);

			document.getElementById("newProjectWindow").style.display = "none";

			projectWindow.style.display = "flex";
			projectTitle.textContent = name;

			// Reset alleen de inhoud (lagen), niet de overlay!
			const mask = document.getElementById("projectClippingMask");
			if (mask) mask.innerHTML = "";

			// Reset zoom & pan EERST zodat addLayer de juiste dimensies berekent
			projectZoom = 1;

			projectCanvasWrapper.style.width = width + "px";
			projectCanvasWrapper.style.height = height + "px";

			// Achtergrond instellen (altijd checkerboard voor transparantie)
			projectCanvasWrapper.style.background =
				"conic-gradient(#ccc 0.25turn, white 0.25turn 0.5turn, #ccc 0.5turn 0.75turn, white 0.75turn)";
			projectCanvasWrapper.style.backgroundSize = "20px 20px";

			// Initialiseer lagen
			projectLayers = [];
			layerIdCounter = 0;
			const bgLayer = addLayer("Achtergrond");

			// Vul de achtergrondlaag met kleur indien niet transparant
			if (bg !== "transparent") {
				bgLayer.ctx.fillStyle = bg;
				bgLayer.ctx.fillRect(0, 0, width, height);
			}

			// Voeg grid overlay toe
			const grid = document.createElement("div");
			grid.className = "pixel-grid-overlay";
			grid.id = "projectGridOverlay";
			if (mask) mask.appendChild(grid);

			// Voeg guides toe
			const guideV = document.createElement("div");
			guideV.id = "guideV";
			guideV.className = "project-guide-line vertical";
			const guideH = document.createElement("div");
			guideH.id = "guideH";
			guideH.className = "project-guide-line horizontal";
			if (mask) mask.appendChild(guideV);
			if (mask) mask.appendChild(guideH);

			updateProjectTransform();
		});
	}

	// Laad laatste project instellingen bij opstarten
	const lastProjectSettings = localStorage.getItem("habboCloneLastProjectSettings");
	if (lastProjectSettings) {
		try {
			const settings = JSON.parse(lastProjectSettings);
			if (settings.width) document.getElementById("newProjectWidth").value = settings.width;
			if (settings.height) document.getElementById("newProjectHeight").value = settings.height;
			if (settings.orientation) document.getElementById("newProjectOrientation").value = settings.orientation;
			if (settings.background) document.getElementById("newProjectBackground").value = settings.background;
			setTimeout(updateProjectPreview, 0); // Wacht even tot DOM klaar is
		} catch (e) {}
	}

	if (closeProjectBtn) {
		closeProjectBtn.addEventListener("click", () => {
			projectWindow.style.display = "none";
			document.getElementById("paperWindow").style.display = "flex";
		});
	}

	// ─────────────────────────────────────────────
	// 📚 LAGEN SYSTEEM
	// ─────────────────────────────────────────────
	let projectLayers = [];
	let activeLayerId = null;
	let layerIdCounter = 0;

	function addLayer(name, w, h) {
		const width = w || Math.round(parseFloat(projectCanvasWrapper.style.width) / projectZoom);
		const height = h || Math.round(parseFloat(projectCanvasWrapper.style.height) / projectZoom);

		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;

		// NIEUW: Zet direct de visuele grootte, anders is hij 0x0 of default size totdat er gezoomd wordt
		canvas.style.width = `${width * projectZoom}px`;
		canvas.style.height = `${height * projectZoom}px`;

		// Styling wordt geregeld door CSS (#projectCanvasWrapper canvas)

		// Voeg toe aan Clipping Mask (niet direct aan wrapper)
		const mask = document.getElementById("projectClippingMask");
		const grid = document.getElementById("projectGridOverlay");
		if (mask && grid) {
			mask.insertBefore(canvas, grid);
		} else if (mask) {
			mask.appendChild(canvas);
		}

		const layer = {
			id: ++layerIdCounter,
			name: name || `Laag ${projectLayers.length + 1}`,
			canvas: canvas,
			ctx: canvas.getContext("2d"),
			visible: true,
			x: 0, // NIEUW: X positie
			y: 0, // NIEUW: Y positie
		};

		projectLayers.push(layer);
		setActiveLayer(layer.id);
		updateLayerZIndexes();
		return layer;
	}

	function setActiveLayer(id) {
		activeLayerId = id;
		renderLayersList();
	}

	function updateLayerZIndexes() {
		// Zet z-index op basis van positie in array (0 is onderste laag)
		projectLayers.forEach((layer, index) => {
			layer.canvas.style.zIndex = index;
		});
		renderLayersList(); // Update thumbnails en volgorde
	}

	function deleteActiveLayer() {
		if (projectLayers.length <= 1) {
			showNotification("Je moet minstens één laag hebben!");
			return;
		}
		const idx = projectLayers.findIndex((l) => l.id === activeLayerId);
		if (idx > -1) {
			const layer = projectLayers[idx];
			layer.canvas.remove(); // Verwijder uit DOM
			projectLayers.splice(idx, 1); // Verwijder uit array

			// Selecteer vorige of volgende laag
			const newIdx = Math.max(0, idx - 1);
			setActiveLayer(projectLayers[newIdx].id);
			updateLayerZIndexes();
		}
	}

	function renderLayersList() {
		const list = document.getElementById("projectLayersList");
		list.innerHTML = "";

		// Loop in omgekeerde volgorde (bovenste laag bovenaan in lijst)
		// We maken een kopie en reversen die voor de weergave
		[...projectLayers].reverse().forEach((layer, reverseIndex) => {
			const div = document.createElement("div");
			div.className = `layer-item ${layer.id === activeLayerId ? "active" : ""}`;
			div.draggable = true; // Sleepbaar maken

			// Oogje (Zichtbaarheid)
			const visBtn = document.createElement("span");
			visBtn.textContent = layer.visible ? "👁️" : "🚫";
			visBtn.style.marginRight = "10px";
			visBtn.style.cursor = "pointer";
			visBtn.title = "Toon/Verberg";
			visBtn.onclick = (e) => {
				e.stopPropagation();
				layer.visible = !layer.visible;
				layer.canvas.style.display = layer.visible ? "block" : "none";
				renderLayersList();
			};

			// Miniatuur
			const thumb = document.createElement("canvas");
			thumb.className = "layer-thumbnail";
			thumb.width = 30;
			thumb.height = 20;
			const tCtx = thumb.getContext("2d");
			// Teken de laag geschaald op de thumbnail
			tCtx.imageSmoothingEnabled = false;
			tCtx.drawImage(layer.canvas, 0, 0, 30, 20);

			// Naam (Dubbelklik om te hernoemen)
			const nameSpan = document.createElement("span");
			nameSpan.textContent = layer.name;
			nameSpan.style.flexGrow = 1;
			nameSpan.ondblclick = (e) => {
				e.stopPropagation();
				const input = document.createElement("input");
				input.type = "text";
				input.value = layer.name;
				input.style.width = "100%";
				input.style.background = "#222";
				input.style.color = "white";
				input.style.border = "none";

				input.onblur = () => {
					layer.name = input.value || layer.name;
					renderLayersList();
				};
				input.onkeydown = (ev) => {
					if (ev.key === "Enter") input.blur();
				};

				nameSpan.textContent = "";
				nameSpan.appendChild(input);
				input.focus();
			};

			const leftGroup = document.createElement("div");
			leftGroup.style.display = "flex";
			leftGroup.style.alignItems = "center";
			leftGroup.appendChild(visBtn);
			leftGroup.appendChild(thumb);

			div.appendChild(leftGroup);
			div.appendChild(nameSpan); // Naam rechts

			div.onclick = () => setActiveLayer(layer.id);

			// Drag & Drop Events
			div.addEventListener("dragstart", (e) => {
				e.dataTransfer.setData("text/plain", layer.id);
				div.style.opacity = "0.5";
			});
			div.addEventListener("dragend", () => {
				div.style.opacity = "1";
			});
			div.addEventListener("dragover", (e) => {
				e.preventDefault(); // Nodig om drop toe te staan
				div.style.borderTop = "2px solid #7bff00"; // Visuele feedback
			});
			div.addEventListener("dragleave", () => {
				div.style.borderTop = "none";
			});
			div.addEventListener("drop", (e) => {
				e.preventDefault();
				div.style.borderTop = "none";
				const draggedId = parseInt(e.dataTransfer.getData("text/plain"));
				if (draggedId !== layer.id) {
					moveLayer(draggedId, layer.id);
				}
			});

			list.appendChild(div);
		});
	}

	document.getElementById("addLayerBtn").addEventListener("click", () => addLayer());
	document.getElementById("deleteLayerBtn").addEventListener("click", deleteActiveLayer);

	function moveLayer(draggedId, targetId) {
		const fromIndex = projectLayers.findIndex((l) => l.id === draggedId);
		const toIndex = projectLayers.findIndex((l) => l.id === targetId);

		if (fromIndex < 0 || toIndex < 0) return;

		// Verplaats in array
		const item = projectLayers.splice(fromIndex, 1)[0];
		// Omdat we droppen OP een item in een omgekeerde lijst, moeten we even goed kijken naar de index.
		// Als we droppen op index X, willen we dat hij daar komt te staan.
		projectLayers.splice(toIndex, 0, item);

		updateLayerZIndexes();
	}

	// Project Zoom & Pan Logic
	let projectZoom = 1;
	let isPanningProject = false;
	let isDrawingProject = false; // NIEUW: Teken status
	let startPanMouse = { x: 0, y: 0 };
	let lastDrawPos = null; // NIEUW: Vorige muispositie voor vloeiende lijnen

	// Selectie variabelen
	let selectionRect = null; // {x, y, w, h} in logische pixels
	let isSelecting = false;
	let isMovingSelection = false;
	let selectionStart = { x: 0, y: 0 };
	let startMoveSelectionMouse = { x: 0, y: 0 };
	let projectClipboard = null;
	let projectUndoStack = []; // NIEUW: Undo stack voor project

	// Transform variabelen
	let isTransforming = false;
	let transformStart = null; // { x, y, w, h, mx, my }
	let transformRotation = 0; // Graden
	let transformAnchor = { x: 0.5, y: 0.5 }; // Relatief (0-1)

	if (projectWorkspace) {
		projectWorkspace.addEventListener("wheel", (e) => {
			if (e.ctrlKey) {
				e.preventDefault();
				let zoomSpeed = 0.002;
				if (projectZoom >= 5) zoomSpeed = 0.02;
				else if (projectZoom >= 1) zoomSpeed = 0.01;

				const newZoom = projectZoom - e.deltaY * zoomSpeed;
				projectZoom = Math.min(Math.max(0.1, newZoom), 128); // Max zoom verhoogd naar 128x (12800%)
				updateProjectTransform();
			} else {
				// Standaard scroll gedrag van browser (overflow: auto)
			}
		});

		projectWorkspace.addEventListener("mousedown", (e) => {
			if (currentProjectTool === "hand" && (e.button === 0 || e.button === 1)) {
				isPanningProject = true;
				startPanMouse = { x: e.clientX, y: e.clientY };
			} else if ((currentProjectTool === "brush" || currentProjectTool === "eraser") && e.button === 0) {
				// NIEUW: Start tekenen
				isDrawingProject = true;
				saveProjectState(); // Save state before drawing
				drawOnActiveLayer(e);
			} else if (currentProjectTool === "select" && e.button === 0) {
				// NIEUW: Start selectie
				const rect = projectCanvasWrapper.getBoundingClientRect();
				const lx = (e.clientX - rect.left) / projectZoom;
				const ly = (e.clientY - rect.top) / projectZoom;

				// Check of we binnen een bestaande selectie klikken om te verplaatsen
				if (
					selectionRect &&
					lx >= selectionRect.x &&
					lx <= selectionRect.x + selectionRect.w &&
					ly >= selectionRect.y &&
					ly <= selectionRect.y + selectionRect.h
				) {
					isMovingSelection = true;
					startMoveSelectionMouse = { x: e.clientX, y: e.clientY };
				} else {
					isSelecting = true;
					selectionStart = { x: lx, y: ly };
					selectionRect = { x: lx, y: ly, w: 0, h: 0 };
					updateSelectionOverlay();
				}
			}
		});

		window.addEventListener("mousemove", (e) => {
			if (isPanningProject) {
				// Hand tool: scroll de container
				const dx = e.clientX - startPanMouse.x;
				const dy = e.clientY - startPanMouse.y;
				projectWorkspace.scrollLeft -= dx;
				projectWorkspace.scrollTop -= dy;
				startPanMouse = { x: e.clientX, y: e.clientY };
			} else if (isDrawingProject) {
				// NIEUW: Teken tijdens slepen
				drawOnActiveLayer(e);
			} else if (isSelecting) {
				// NIEUW: Update selectie
				const rect = projectCanvasWrapper.getBoundingClientRect();
				const lx = (e.clientX - rect.left) / projectZoom;
				const ly = (e.clientY - rect.top) / projectZoom;

				const x = Math.min(selectionStart.x, lx);
				const y = Math.min(selectionStart.y, ly);
				const w = Math.abs(lx - selectionStart.x);
				const h = Math.abs(ly - selectionStart.y);

				selectionRect = { x, y, w, h };
				updateSelectionOverlay();
			} else if (isMovingSelection && selectionRect) {
				// NIEUW: Verplaats selectie kader
				const dx = (e.clientX - startMoveSelectionMouse.x) / projectZoom;
				const dy = (e.clientY - startMoveSelectionMouse.y) / projectZoom;

				selectionRect.x += dx;
				selectionRect.y += dy;

				startMoveSelectionMouse = { x: e.clientX, y: e.clientY };
				updateSelectionOverlay();
			}
		});

		window.addEventListener("mouseup", () => {
			if (isSelecting) {
				isSelecting = false;
				// Afronden naar hele pixels voor pixel art
				if (selectionRect) {
					selectionRect.x = Math.floor(selectionRect.x);
					selectionRect.y = Math.floor(selectionRect.y);
					selectionRect.w = Math.round(selectionRect.w);
					selectionRect.h = Math.round(selectionRect.h);
					if (selectionRect.w === 0 || selectionRect.h === 0) selectionRect = null;
					updateSelectionOverlay();
				}
			}

			if (isMovingSelection) {
				isMovingSelection = false;
				if (selectionRect) {
					selectionRect.x = Math.round(selectionRect.x);
					selectionRect.y = Math.round(selectionRect.y);
					updateSelectionOverlay();
				}
			}

			isPanningProject = false;
			isDrawingProject = false;
			lastDrawPos = null; // Reset lijn
		});
	}

	// NIEUW: Tekenfunctie
	function drawOnActiveLayer(e) {
		if (!activeLayerId) return;
		const layer = projectLayers.find((l) => l.id === activeLayerId);
		if (!layer || !layer.visible) return;

		// Bereken coördinaten relatief aan het canvas (rekening houdend met zoom en pan)
		const rect = projectCanvasWrapper.getBoundingClientRect();
		// NIEUW: Corrigeer voor de positie van de laag zelf (layer.x/y)
		const x = (e.clientX - rect.left) / projectZoom - layer.x;
		const y = (e.clientY - rect.top) / projectZoom - layer.y;

		const ctx = layer.ctx;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";

		if (currentProjectTool === "brush") {
			ctx.globalCompositeOperation = "source-over";
			ctx.strokeStyle = projectToolSettings.text.color; // Gebruik de kleur uit de settings (die ook voor text wordt gebruikt, of maak apart)
			// Omdat we nog geen aparte kleur voor brush hadden, gebruiken we de projectColorPicker direct
			ctx.strokeStyle = projectColorPicker.color.hexString;
			ctx.lineWidth = projectToolSettings.brush.size;
			ctx.globalAlpha = projectToolSettings.brush.opacity / 100;
		} else if (currentProjectTool === "eraser") {
			ctx.globalCompositeOperation = "destination-out";
			ctx.lineWidth = projectToolSettings.eraser.size;
			ctx.globalAlpha = projectToolSettings.eraser.opacity / 100;
		}

		ctx.beginPath();
		if (lastDrawPos) {
			ctx.moveTo(lastDrawPos.x, lastDrawPos.y);
		} else {
			ctx.moveTo(x, y);
		}
		ctx.lineTo(x, y);
		ctx.stroke();

		lastDrawPos = { x, y };
	}

	function updateProjectTransform() {
		if (projectCanvasWrapper && projectWorkspace) {
			const canvas = projectCanvasWrapper.querySelector("canvas");
			if (!canvas) return;

			// Verberg transform overlay tijdens zoomen om glitches te voorkomen
			// (wordt gereset bij volgende interactie of tool switch)
			if (isTransforming) cancelTransform();

			// Gebruik CSS width/height voor zoom (scherpe pixels dankzij image-rendering: pixelated)
			const origW = canvas.width;
			const origH = canvas.height;
			const newW = origW * projectZoom;
			const newH = origH * projectZoom;

			projectCanvasWrapper.style.width = `${newW}px`;
			projectCanvasWrapper.style.height = `${newH}px`;

			// Reset transform, we gebruiken nu layout flow
			projectCanvasWrapper.style.transform = "none";

			if (projectZoom <= 1) {
				// Vergrendel scrollen en centreer
				projectWorkspace.style.overflow = "hidden";
				projectWorkspace.style.justifyContent = "center";
				projectWorkspace.style.alignItems = "center";
				projectCanvasWrapper.style.margin = "0";
			} else {
				// Sta scrollen toe
				projectWorkspace.style.overflow = "auto";
				projectWorkspace.style.justifyContent = "flex-start";
				projectWorkspace.style.alignItems = "flex-start";
				// Margin auto zorgt voor centrering als het canvas kleiner is dan de viewport (bijv. bij uitzoomen in een groot venster)
				projectCanvasWrapper.style.margin = "auto";
			}

			// NIEUW: Update posities van alle lagen (voor als we zoomen)
			projectLayers.forEach((layer) => {
				layer.canvas.style.width = `${layer.canvas.width * projectZoom}px`;
				layer.canvas.style.height = `${layer.canvas.height * projectZoom}px`;
				layer.canvas.style.left = `${layer.x * projectZoom}px`;
				layer.canvas.style.top = `${layer.y * projectZoom}px`;
			});

			const zoomEl = document.getElementById("projectZoomLevel");
			if (zoomEl) zoomEl.textContent = Math.round(projectZoom * 100) + "%";

			// Toon pixel grid als we ver ingezoomd zijn (>= 800%)
			const grid = document.getElementById("projectGridOverlay");
			if (grid) {
				grid.style.display = projectZoom >= 8 ? "block" : "none";
				if (projectZoom >= 8) {
					// Grid moet meeschalen
					grid.style.backgroundSize = `${projectZoom}px ${projectZoom}px`;
				}
			}

			// Update selectie overlay bij zoomen
			updateSelectionOverlay();
		}
	}

	function updateSelectionOverlay() {
		const el = document.getElementById("projectSelectionOverlay");
		if (el) {
			if (selectionRect) {
				el.style.display = "block";
				el.style.left = selectionRect.x * projectZoom + "px";
				el.style.top = selectionRect.y * projectZoom + "px";
				el.style.width = selectionRect.w * projectZoom + "px";
				el.style.height = selectionRect.h * projectZoom + "px";
			} else {
				el.style.display = "none";
			}
		}
	}

	// Project Color Picker
	const projectColorPicker = new iro.ColorPicker("#project-color-picker-container", {
		width: 200,
		color: "#ffffff",
		borderWidth: 1,
		borderColor: "#fff",
		layout: [{ component: iro.ui.Box }, { component: iro.ui.Slider, options: { sliderType: "hue" } }],
	});

	// Project Tool Logic
	const projToolBtns = {
		transform: document.getElementById("projToolTransform"),
		hand: document.getElementById("projToolHand"),
		select: document.getElementById("projToolSelect"),
		brush: document.getElementById("projToolBrush"),
		eraser: document.getElementById("projToolEraser"),
		text: document.getElementById("projToolText"),
		picker: document.getElementById("projToolPicker"),
	};

	const projectSubHeader = document.getElementById("projectSubHeader");

	let currentProjectTool = "hand";
	const projectToolSettings = {
		brush: { type: "round", size: 5, opacity: 100 },
		eraser: { type: "hard", size: 10, opacity: 100 },
		text: { font: "Arial", family: "Regular", size: 14, color: "#ffffff", align: "Links" },
	};

	function setActiveProjectTool(tool) {
		currentProjectTool = tool;

		// Reset transform mode als we wisselen
		if (tool !== "transform" && isTransforming) {
			cancelTransform();
		}
		if (tool === "transform") initTransform();

		// Update UI buttons
		Object.values(projToolBtns).forEach((btn) => {
			if (btn) btn.classList.remove("active");
		});
		if (projToolBtns[tool]) projToolBtns[tool].classList.add("active");

		// Update SubHeader
		updateProjectSubHeader();

		// Update cursor
		const workspace = document.getElementById("projectWorkspace");
		if (tool === "transform") workspace.style.cursor = "default";
		if (tool === "hand") workspace.style.cursor = "grab";
		else if (tool === "text") workspace.style.cursor = "text";
		else if (tool === "select") workspace.style.cursor = "crosshair";
		else workspace.style.cursor = "crosshair";
		if (tool === "picker") workspace.style.cursor = "crosshair";
	}

	function updateProjectSubHeader() {
		projectSubHeader.innerHTML = "";
		projectSubHeader.style.gap = "15px";

		if (currentProjectTool === "brush") {
			createControl(
				"Type:",
				createSelect(
					["Rond", "Vierkant"],
					projectToolSettings.brush.type === "round" ? "Rond" : "Vierkant",
					(e) => (projectToolSettings.brush.type = e.target.value === "Rond" ? "round" : "square")
				)
			);
			createControl(
				"Grootte:",
				createInput(
					"number",
					projectToolSettings.brush.size,
					1,
					100,
					(e) => (projectToolSettings.brush.size = parseInt(e.target.value)),
					"40px"
				)
			);

			const opWrapper = document.createElement("div");
			opWrapper.style.display = "flex";
			opWrapper.style.alignItems = "center";
			opWrapper.appendChild(
				createInput(
					"number",
					projectToolSettings.brush.opacity,
					0,
					100,
					(e) => (projectToolSettings.brush.opacity = parseInt(e.target.value)),
					"40px"
				)
			);
			const span = document.createElement("span");
			span.innerText = "%";
			span.style.marginLeft = "2px";
			opWrapper.appendChild(span);
			createControl("Dekking:", opWrapper);
		} else if (currentProjectTool === "eraser") {
			createControl(
				"Type:",
				createSelect(
					["Zacht", "Hard"],
					projectToolSettings.eraser.type === "soft" ? "Zacht" : "Hard",
					(e) => (projectToolSettings.eraser.type = e.target.value === "Zacht" ? "soft" : "hard")
				)
			);
			createControl(
				"Grootte:",
				createInput(
					"number",
					projectToolSettings.eraser.size,
					1,
					100,
					(e) => (projectToolSettings.eraser.size = parseInt(e.target.value)),
					"40px"
				)
			);

			const opWrapper = document.createElement("div");
			opWrapper.style.display = "flex";
			opWrapper.style.alignItems = "center";
			opWrapper.appendChild(
				createInput(
					"number",
					projectToolSettings.eraser.opacity,
					0,
					100,
					(e) => (projectToolSettings.eraser.opacity = parseInt(e.target.value)),
					"40px"
				)
			);
			const span = document.createElement("span");
			span.innerText = "%";
			span.style.marginLeft = "2px";
			opWrapper.appendChild(span);
			createControl("Dekking:", opWrapper);
		} else if (currentProjectTool === "text") {
			createControl(
				"Font:",
				createSelect(
					["Arial", "Verdana", "Times New Roman", "Courier New"],
					projectToolSettings.text.font,
					(e) => (projectToolSettings.text.font = e.target.value)
				)
			);
			createControl(
				"Stijl:",
				createSelect(
					["Regular", "Bold", "Italic", "Bold Italic"],
					projectToolSettings.text.family,
					(e) => (projectToolSettings.text.family = e.target.value)
				)
			);
			createControl(
				"Pt:",
				createInput(
					"number",
					projectToolSettings.text.size,
					1,
					200,
					(e) => (projectToolSettings.text.size = parseInt(e.target.value)),
					"40px"
				)
			);

			// Custom Color Box
			const colorBox = document.createElement("div");
			colorBox.style.width = "18px";
			colorBox.style.height = "18px";
			colorBox.style.backgroundColor = projectToolSettings.text.color;
			colorBox.style.border = "1px solid #fff";
			colorBox.style.cursor = "pointer";
			colorBox.style.borderRadius = "2px";

			colorBox.onclick = () => {
				openTextColorPicker(projectToolSettings.text.color, (newColor) => {
					projectToolSettings.text.color = newColor;
					colorBox.style.backgroundColor = newColor;
				});
			};
			createControl("Kleur:", colorBox);

			createControl(
				"Uitlijning:",
				createSelect(
					["Links", "Gecentreerd", "Rechts"],
					projectToolSettings.text.align,
					(e) => (projectToolSettings.text.align = e.target.value)
				)
			);
		}
	}

	function createControl(labelText, inputElement) {
		const container = document.createElement("div");
		container.style.display = "flex";
		container.style.alignItems = "center";
		const lbl = document.createElement("span");
		lbl.textContent = labelText;
		container.appendChild(lbl);
		container.appendChild(inputElement);
		projectSubHeader.appendChild(container);
	}

	function createSelect(options, selected, onChange) {
		const sel = document.createElement("select");
		options.forEach((opt) => {
			const o = document.createElement("option");
			o.value = opt;
			o.textContent = opt;
			if (opt === selected) o.selected = true;
			sel.appendChild(o);
		});
		sel.onchange = onChange;
		return sel;
	}

	function createInput(type, value, min, max, onChange, width) {
		const inp = document.createElement("input");
		inp.type = type;
		inp.value = value;
		if (min !== undefined && min !== null) inp.min = min;
		if (max !== undefined && max !== null) inp.max = max;
		if (width) inp.style.width = width;
		if (type === "range") inp.oninput = onChange;
		else inp.onchange = onChange;
		return inp;
	}

	// Text Color Picker Window Logic
	const colorSelectionWindow = document.getElementById("colorSelectionWindow");
	let textColorPicker = null;
	let onColorConfirm = null;

	function openTextColorPicker(currentColor, onConfirm) {
		colorSelectionWindow.style.display = "flex";
		colorSelectionWindow.style.zIndex = 60;

		if (!textColorPicker) {
			textColorPicker = new iro.ColorPicker("#text-color-picker-container", {
				width: 200,
				color: currentColor,
				borderWidth: 1,
				borderColor: "#fff",
				layout: [{ component: iro.ui.Box }, { component: iro.ui.Slider, options: { sliderType: "hue" } }],
			});
		} else {
			textColorPicker.color.hexString = currentColor;
		}
		onColorConfirm = onConfirm;
	}

	document.getElementById("confirmColorBtn").addEventListener("click", () => {
		if (onColorConfirm && textColorPicker) {
			onColorConfirm(textColorPicker.color.hexString);
		}
		colorSelectionWindow.style.display = "none";
	});

	document.getElementById("cancelColorBtn").addEventListener("click", () => {
		colorSelectionWindow.style.display = "none";
	});

	// Event listeners
	if (projToolBtns.transform) projToolBtns.transform.onclick = () => setActiveProjectTool("transform");
	if (projToolBtns.hand) projToolBtns.hand.onclick = () => setActiveProjectTool("hand");
	if (projToolBtns.select) projToolBtns.select.onclick = () => setActiveProjectTool("select");
	if (projToolBtns.brush) projToolBtns.brush.onclick = () => setActiveProjectTool("brush");
	if (projToolBtns.eraser) projToolBtns.eraser.onclick = () => setActiveProjectTool("eraser");
	if (projToolBtns.text) projToolBtns.text.onclick = () => setActiveProjectTool("text");
	if (projToolBtns.picker) projToolBtns.picker.onclick = () => setActiveProjectTool("picker");

	// Init
	setActiveProjectTool("hand");

	// NIEUW: Project Undo Functies
	function saveProjectState() {
		if (!activeLayerId) return;
		const layer = projectLayers.find((l) => l.id === activeLayerId);
		if (!layer) return;

		// Sla de huidige staat van de actieve laag op
		const state = {
			layerId: layer.id,
			imageData: layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height),
			x: layer.x,
			y: layer.y,
		};
		projectUndoStack.push(state);
		if (projectUndoStack.length > 20) projectUndoStack.shift(); // Max 20 steps
	}

	function undoProjectAction() {
		if (projectUndoStack.length === 0) return;
		const state = projectUndoStack.pop();
		const layer = projectLayers.find((l) => l.id === state.layerId);
		if (layer) {
			layer.ctx.putImageData(state.imageData, 0, 0);
			layer.x = state.x;
			layer.y = state.y;
			updateProjectTransform(); // Update posities
		}
	}

	// ─────────────────────────────────────────────
	// 📐 TRANSFORM TOOL LOGICA
	// ─────────────────────────────────────────────
	const transformOverlay = document.getElementById("transformOverlay");
	let activeTransformHandle = null;
	let transformMode = null; // 'resize', 'move', 'rotate', 'anchor'

	// Helper om te checken of een canvas leeg is
	function isCanvasEmpty(canvas) {
		const ctx = canvas.getContext("2d");
		const w = canvas.width;
		const h = canvas.height;
		try {
			const idata = ctx.getImageData(0, 0, w, h);
			const data = idata.data;
			for (let i = 3; i < data.length; i += 4) {
				if (data[i] > 0) return false; // Alpha > 0 gevonden (niet leeg)
			}
			return true;
		} catch (e) {
			return false; // Bij error (bv tainted canvas) gaan we ervan uit dat het niet leeg is
		}
	}

	function initTransform() {
		if (!activeLayerId) return;
		const layer = projectLayers.find((l) => l.id === activeLayerId);
		if (!layer) return;

		if (isCanvasEmpty(layer.canvas)) {
			showNotification("Lege laag kan niet getransformeerd worden.");
			setActiveProjectTool("pointer");
			return;
		}

		saveProjectState(); // Save state before transform
		isTransforming = true;
		transformOverlay.style.display = "block";

		// Reset transform values
		transformRotation = 0;
		transformAnchor = { x: 0.5, y: 0.5 };

		// Zet overlay op positie van de laag
		updateTransformOverlay(layer);
	}

	function updateTransformOverlay(layer) {
		// Gebruik huidige visuele waarden
		const rect = {
			left: parseFloat(layer.canvas.style.left) || 0,
			top: parseFloat(layer.canvas.style.top) || 0,
			width: parseFloat(layer.canvas.style.width) || layer.canvas.width * projectZoom,
			height: parseFloat(layer.canvas.style.height) || layer.canvas.height * projectZoom,
		};

		transformOverlay.style.left = rect.left + "px";
		transformOverlay.style.top = rect.top + "px";
		transformOverlay.style.width = rect.width + "px";
		transformOverlay.style.height = rect.height + "px";

		// Update rotatie en anchor visueel
		const anchorEl = document.getElementById("transformAnchor");
		anchorEl.style.left = transformAnchor.x * 100 + "%";
		anchorEl.style.top = transformAnchor.y * 100 + "%";

		const transformStr = `rotate(${transformRotation}deg)`;
		transformOverlay.style.transform = transformStr;
		transformOverlay.style.transformOrigin = `${transformAnchor.x * 100}% ${transformAnchor.y * 100}%`;
	}

	function applyTransform() {
		if (!isTransforming || !activeLayerId) return;
		const layer = projectLayers.find((l) => l.id === activeLayerId);
		if (!layer) return;

		// Huidige visuele waarden (gezoomd)
		const visualLeft = parseFloat(transformOverlay.style.left);
		const visualTop = parseFloat(transformOverlay.style.top);
		const visualWidth = parseFloat(transformOverlay.style.width);
		const visualHeight = parseFloat(transformOverlay.style.height);

		// Bereken nieuwe logische waarden (ongezoomd)
		const newX = visualLeft / projectZoom;
		const newY = visualTop / projectZoom;
		const newW = Math.round(visualWidth / projectZoom);
		const newH = Math.round(visualHeight / projectZoom);

		// Bereken het ankerpunt in de originele (unrotated) box
		const anchorX = newX + newW * transformAnchor.x;
		const anchorY = newY + newH * transformAnchor.y;

		// Bereken het centrum van de originele box
		const oldCenterX = newX + newW / 2;
		const oldCenterY = newY + newH / 2;

		// Maak nieuw canvas
		// We moeten de bounding box van de geroteerde image berekenen om de nieuwe canvas grootte te bepalen
		// Voor simpelheid maken we een canvas dat groot genoeg is (diagonaal)
		const rad = (transformRotation * Math.PI) / 180;
		const cos = Math.cos(rad);
		const sin = Math.sin(rad);
		const absCos = Math.abs(cos);
		const absSin = Math.abs(sin);

		// Nieuwe bounding box grootte na rotatie
		const rotatedW = Math.round(newW * absCos + newH * absSin);
		const rotatedH = Math.round(newW * absSin + newH * absCos);

		const newCanvas = document.createElement("canvas");
		newCanvas.width = rotatedW;
		newCanvas.height = rotatedH;
		const ctx = newCanvas.getContext("2d");

		ctx.imageSmoothingEnabled = false; // Pixel art behouden

		// Verplaats naar midden van nieuwe canvas
		ctx.translate(rotatedW / 2, rotatedH / 2);
		// Roteer
		ctx.rotate(rad);
		// Teken afbeelding gecentreerd (geschaald)
		ctx.drawImage(layer.canvas, 0, 0, layer.canvas.width, layer.canvas.height, -newW / 2, -newH / 2, newW, newH);

		// Bereken de nieuwe positie van het centrum na rotatie om het ankerpunt
		// Vector van Anker naar Oud Centrum
		const dx = oldCenterX - anchorX;
		const dy = oldCenterY - anchorY;

		// Roteer deze vector
		const newDx = dx * cos - dy * sin;
		const newDy = dx * sin + dy * cos;

		// Nieuw centrum is Anker + Geroteerde vector
		const newCenterX = anchorX + newDx;
		const newCenterY = anchorY + newDy;

		// De nieuwe top-left is Nieuw Centrum - halve nieuwe afmetingen
		const finalX = newCenterX - rotatedW / 2;
		const finalY = newCenterY - rotatedH / 2;

		// Vervang layer canvas
		// Behoud z-index en display
		newCanvas.style.zIndex = layer.canvas.style.zIndex;
		newCanvas.style.display = layer.canvas.style.display;
		newCanvas.style.position = "absolute";

		// Verwijder oude, plaats nieuwe
		layer.canvas.replaceWith(newCanvas);
		layer.canvas = newCanvas;
		layer.ctx = ctx;

		// Update layer properties
		layer.x = finalX;
		layer.y = finalY;

		// Update visuele stijl
		layer.canvas.style.left = `${finalX * projectZoom}px`;
		layer.canvas.style.top = `${finalY * projectZoom}px`;
		layer.canvas.style.width = `${rotatedW * projectZoom}px`;
		layer.canvas.style.height = `${rotatedH * projectZoom}px`;

		cancelTransform(); // Sluit overlay
		setActiveProjectTool("hand"); // Terug naar hand (of vorige tool)
	}

	function cancelTransform() {
		isTransforming = false;
		transformOverlay.style.display = "none";
		activeTransformHandle = null;
		transformMode = null;

		// Reset layer visual style naar origineel (voor het geval we aan het slepen waren)
		if (activeLayerId) {
			const layer = projectLayers.find((l) => l.id === activeLayerId);
			if (layer) {
				layer.canvas.style.left = `${layer.x * projectZoom}px`;
				layer.canvas.style.top = `${layer.y * projectZoom}px`;
				layer.canvas.style.width = `${layer.canvas.width * projectZoom}px`;
				layer.canvas.style.height = `${layer.canvas.height * projectZoom}px`;
				layer.canvas.style.transform = "none"; // Reset preview rotatie
			}
		}
	}

	// Handle interactie
	document.querySelectorAll(".transform-handle").forEach((handle) => {
		handle.addEventListener("mousedown", (e) => {
			if (!isTransforming) return;
			e.stopPropagation();
			e.preventDefault();
			activeTransformHandle = handle.dataset.dir;
			transformMode = "resize";

			transformStart = {
				x: parseFloat(transformOverlay.style.left),
				y: parseFloat(transformOverlay.style.top),
				w: parseFloat(transformOverlay.style.width),
				h: parseFloat(transformOverlay.style.height),
				mx: e.clientX,
				my: e.clientY,
				rot: transformRotation,
				// Sla ook de initiële center op in schermcoördinaten voor rotatie-correctie tijdens resize
				cx: parseFloat(transformOverlay.style.left) + parseFloat(transformOverlay.style.width) / 2,
				cy: parseFloat(transformOverlay.style.top) + parseFloat(transformOverlay.style.height) / 2,
			};
		});
	});

	// Rotator interactie (De nieuwe hendel)
	document.getElementById("transformRotator").addEventListener("mousedown", (e) => {
		if (!isTransforming) return;
		e.stopPropagation();
		e.preventDefault();
		transformMode = "rotate";

		// Bereken start hoek t.o.v. het ANKERPUNT
		const wrapperRect = projectCanvasWrapper.getBoundingClientRect();
		// ... (rest van berekening gebeurt in mousemove, we hebben alleen de start nodig)
		// We gebruiken dezelfde logica als de hoek-rotatie, maar nu expliciet via de hendel
		// We simuleren een klik op de overlay voor de initialisatie van waarden
		// Maar we moeten wel weten waar het anker is.
		initRotateDrag(e);
	});

	// Anchor interactie
	document.getElementById("transformAnchor").addEventListener("mousedown", (e) => {
		if (!isTransforming) return;
		e.stopPropagation();
		e.preventDefault();
		transformMode = "anchor";
		transformStart = {
			w: parseFloat(transformOverlay.style.width),
			h: parseFloat(transformOverlay.style.height),
			mx: e.clientX,
			my: e.clientY,
			ax: transformAnchor.x,
			ay: transformAnchor.y,
		};
	});

	// Helper voor start rotatie
	function initRotateDrag(e) {
		const wrapperRect = projectCanvasWrapper.getBoundingClientRect();
		const currentLeft = parseFloat(transformOverlay.style.left);
		const currentTop = parseFloat(transformOverlay.style.top);
		const currentW = parseFloat(transformOverlay.style.width);
		const currentH = parseFloat(transformOverlay.style.height);

		const anchorScreenX = wrapperRect.left + currentLeft + currentW * transformAnchor.x;
		const anchorScreenY = wrapperRect.top + currentTop + currentH * transformAnchor.y;

		transformStart = {
			startAngle: (Math.atan2(e.clientY - anchorScreenY, e.clientX - anchorScreenX) * 180) / Math.PI,
			initialRot: transformRotation,
			cx: anchorScreenX,
			cy: anchorScreenY,
		};
	}

	// Overlay interactie (Move & Rotate)
	transformOverlay.addEventListener("mousedown", (e) => {
		if (!isTransforming || e.target !== transformOverlay) return;
		e.stopPropagation();
		e.preventDefault();

		// Check of we dicht bij een hoek zijn voor rotatie
		const rect = transformOverlay.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		const w = rect.width;
		const h = rect.height;
		const cornerDist = 20; // Pixel marge

		const nw = Math.sqrt(x * x + y * y);
		const ne = Math.sqrt((x - w) * (x - w) + y * y);
		const sw = Math.sqrt(x * x + (y - h) * (y - h));
		const se = Math.sqrt((x - w) * (x - w) + (y - h) * (y - h));

		if (nw < cornerDist || ne < cornerDist || sw < cornerDist || se < cornerDist) {
			transformMode = "rotate";
			initRotateDrag(e);
		} else {
			transformMode = "move";
			transformStart = {
				x: parseFloat(transformOverlay.style.left),
				y: parseFloat(transformOverlay.style.top),
				mx: e.clientX,
				my: e.clientY,
			};
		}
	});

	window.addEventListener("mousemove", (e) => {
		if (isTransforming && transformMode === "resize" && activeTransformHandle && transformStart) {
			// 1. Bereken muis delta in scherm ruimte
			const screenDx = e.clientX - transformStart.mx;
			const screenDy = e.clientY - transformStart.my;

			// 2. Roteer delta naar lokale ruimte van het object
			const rad = (-transformStart.rot * Math.PI) / 180;
			const dx = screenDx * Math.cos(rad) - screenDy * Math.sin(rad);
			const dy = screenDx * Math.sin(rad) + screenDy * Math.cos(rad);

			let newX = transformStart.x;
			let newY = transformStart.y;
			let newW = transformStart.w;
			let newH = transformStart.h;

			const ratio = transformStart.w / transformStart.h;

			// 1. Bepaal Ankerpunt (het punt dat stil blijft staan)
			let anchorX, anchorY;
			if (e.altKey) {
				// Bij Alt is het ankerpunt altijd het midden
				anchorX = transformStart.x + transformStart.w / 2;
				anchorY = transformStart.y + transformStart.h / 2;
			} else {
				// Anders is het de tegenovergestelde kant
				if (activeTransformHandle.includes("w")) anchorX = transformStart.x + transformStart.w;
				else if (activeTransformHandle.includes("e")) anchorX = transformStart.x;
				else anchorX = transformStart.x + transformStart.w / 2;

				if (activeTransformHandle.includes("n")) anchorY = transformStart.y + transformStart.h;
				else if (activeTransformHandle.includes("s")) anchorY = transformStart.y;
				else anchorY = transformStart.y + transformStart.h / 2;
			}

			// 2. Bereken nieuwe positie van de handle
			let startHandleX, startHandleY;
			if (activeTransformHandle.includes("w")) startHandleX = transformStart.x;
			else if (activeTransformHandle.includes("e")) startHandleX = transformStart.x + transformStart.w;
			else startHandleX = transformStart.x + transformStart.w / 2;

			if (activeTransformHandle.includes("n")) startHandleY = transformStart.y;
			else if (activeTransformHandle.includes("s")) startHandleY = transformStart.y + transformStart.h;
			else startHandleY = transformStart.y + transformStart.h / 2;

			let newHandleX = startHandleX + dx;
			let newHandleY = startHandleY + dy;

			// 3. Bereken nieuwe afmetingen en positie
			if (e.altKey) {
				// Center scaling (Symmetrisch)
				let distW = Math.abs(newHandleX - anchorX);
				let distH = Math.abs(newHandleY - anchorY);

				if (activeTransformHandle === "n" || activeTransformHandle === "s") {
					newH = distH * 2;
					newW = transformStart.w;
					if (e.shiftKey) newW = newH * ratio;
				} else if (activeTransformHandle === "e" || activeTransformHandle === "w") {
					newW = distW * 2;
					newH = transformStart.h;
					if (e.shiftKey) newH = newW / ratio;
				} else {
					newW = distW * 2;
					newH = distH * 2;
					if (e.shiftKey) {
						if (newW / newH > ratio) newH = newW / ratio;
						else newW = newH * ratio;
					}
				}
				newX = anchorX - newW / 2;
				newY = anchorY - newH / 2;
			} else {
				// Anchor scaling (Vanaf ankerpunt)
				if (activeTransformHandle.includes("w")) {
					newW = anchorX - newHandleX;
					newX = newHandleX;
				} else if (activeTransformHandle.includes("e")) {
					newW = newHandleX - anchorX;
					newX = anchorX;
				} else {
					newW = transformStart.w;
					newX = transformStart.x;
				}

				if (activeTransformHandle.includes("n")) {
					newH = anchorY - newHandleY;
					newY = newHandleY;
				} else if (activeTransformHandle.includes("s")) {
					newH = newHandleY - anchorY;
					newY = anchorY;
				} else {
					newH = transformStart.h;
					newY = transformStart.y;
				}

				if (e.shiftKey) {
					if (activeTransformHandle.length === 2) {
						// Hoek
						if (newW / newH > ratio) {
							newH = newW / ratio;
							if (activeTransformHandle.includes("n")) newY = anchorY - newH;
						} else {
							newW = newH * ratio;
							if (activeTransformHandle.includes("w")) newX = anchorX - newW;
						}
					} else {
						// Zijkant
						if (activeTransformHandle === "w" || activeTransformHandle === "e") {
							newH = newW / ratio;
							newY = anchorY - newH / 2;
						} else {
							newW = newH * ratio;
							newX = anchorX - newW / 2;
						}
					}
				}
			}

			// Voorkom negatieve grootte (flippen)
			if (newW < 1) {
				newW = 1;
				if (activeTransformHandle.includes("w")) newX = anchorX - 1;
			}
			if (newH < 1) {
				newH = 1;
				if (activeTransformHandle.includes("n")) newY = anchorY - 1;
			}

			// 4. Correctie voor positie verschuiving door rotatie
			// Omdat CSS transform-origin werkt op basis van %, en we de width/height aanpassen,
			// verschuift het visuele centrum. We moeten left/top aanpassen om dit tegen te gaan.

			// Oud lokaal centrum (relatief aan top-left)
			const oldLocalCx = transformStart.w / 2;
			const oldLocalCy = transformStart.h / 2;

			// Nieuw lokaal centrum
			const newLocalCx = newW / 2;
			const newLocalCy = newH / 2;

			// De verschuiving van het centrum in lokale ruimte
			const dCx = newLocalCx - oldLocalCx + (newX - transformStart.x);
			const dCy = newLocalCy - oldLocalCy + (newY - transformStart.y);

			// Roteer deze verschuiving terug naar scherm ruimte
			const rotRad = (transformStart.rot * Math.PI) / 180;
			const screenShiftX = dCx * Math.cos(rotRad) - dCy * Math.sin(rotRad);
			const screenShiftY = dCx * Math.sin(rotRad) + dCy * Math.cos(rotRad);

			// De nieuwe top-left is de oude center + shift - nieuwe halve afmetingen (ongeveer)
			// Beter: We berekenen waar het nieuwe midden moet zijn in scherm ruimte.
			// Het oude midden in scherm ruimte was transformStart.cx/cy.
			// Het nieuwe midden is transformStart.cx + (screenShiftX - (newX - transformStart.x)???)

			// Simpelere benadering:
			// We hebben newX/newY berekend alsof rotatie 0 is.
			// Het verschil tussen (newX, newY) en (transformStart.x, transformStart.y) is de lokale verplaatsing van de top-left corner.
			const localMoveX = newX - transformStart.x;
			const localMoveY = newY - transformStart.y;

			// Maar door de rotatie, beweegt de top-left corner in een andere richting op het scherm.
			// We moeten de overlay positioneren zodat het visueel klopt.

			// Bereken het midden van de nieuwe box in lokale ruimte t.o.v. de oude top-left
			const localCenterX = newX + newW / 2;
			const localCenterY = newY + newH / 2;

			// Het oorspronkelijke midden was:
			const startCenterX = transformStart.x + transformStart.w / 2;
			const startCenterY = transformStart.y + transformStart.h / 2;

			// De vector van oud midden naar nieuw midden in LOKALE ruimte
			const vCx = localCenterX - startCenterX;
			const vCy = localCenterY - startCenterY;

			// Roteer deze vector naar SCHERM ruimte
			const screenVCx = vCx * Math.cos(rotRad) - vCy * Math.sin(rotRad);
			const screenVCy = vCx * Math.sin(rotRad) + vCy * Math.cos(rotRad);

			// Het nieuwe scherm-midden
			const newScreenCx = transformStart.cx + screenVCx;
			const newScreenCy = transformStart.cy + screenVCy;

			// De nieuwe left/top van de overlay (die ongeroteerd is in de DOM, maar geroteerd door CSS)
			// De CSS transform gebeurt rond het midden (of anchor).
			// Als we left/top instellen, bepaalt dat de positie van het ongeroteerde vierkant.
			// De rotatie draait het dan om het ankerpunt.

			// We moeten left/top zo zetten dat het midden van de div op newScreenCx, newScreenCy komt.
			// (Aannemende dat transform-origin in het midden blijft voor de berekening, maar dat is niet zo als anchor verschoven is)

			// Omdat transformAnchor relatief is (%), en we W/H veranderen, blijft het anker op dezelfde relatieve plek.
			// Maar we willen dat de overlay op de juiste plek staat.

			// De simpelste manier voor de overlay positie:
			// Center = Left + Width/2.
			// Dus Left = Center - Width/2.

			const finalLeft = newScreenCx - newW / 2;
			const finalTop = newScreenCy - newH / 2;

			// 5. Snapping naar Canvas Midden (NIEUW)
			// Canvas afmetingen
			const canvasW = parseInt(projectCanvasWrapper.style.width) / projectZoom;
			const canvasH = parseInt(projectCanvasWrapper.style.height) / projectZoom;

			// Huidig midden van het object (in lokale ongezoomde coördinaten, relatief aan canvas 0,0)
			// newX/newY zijn de top-left posities.
			const objectCenterX = newX + newW / 2;
			const objectCenterY = newY + newH / 2;

			const canvasCenterX = canvasW / 2;
			const canvasCenterY = canvasH / 2;

			const snapDist = 10; // Drempelwaarde

			// Toon guides en snap
			const guideV = document.getElementById("guideV");
			const guideH = document.getElementById("guideH");

			// We passen finalLeft/Top aan (visueel) en newX/newY (logisch)
			// Let op: finalLeft is schermpositie. We moeten snappen in schermruimte of logische ruimte.
			// Het makkelijkst is logische ruimte aanpassen en dan finalLeft herberekenen,
			// maar finalLeft is complex door rotatie.
			// Simpeler: We checken of het midden dichtbij het canvas midden is, en zo ja, verschuiven we alles.

			if (Math.abs(objectCenterX - canvasCenterX) < snapDist) {
				const diffX = canvasCenterX - objectCenterX;
				newX += diffX; // Verschuif logische X
				// Verschuif ook visuele X
				// Omdat diffX in logische pixels is, moeten we * zoom doen voor schermpixels?
				// Nee, finalLeft is in schermpixels (relatief aan wrapper parent? Nee, transformOverlay is absolute in wrapper).
				// Wacht, transformOverlay zit in projectCanvasWrapper.
				// Dus left/top zijn relatief aan de wrapper (die geschaald is of niet?).
				// projectCanvasWrapper heeft GEEN transform scale meer (dat is weggehaald in updateProjectTransform).
				// In plaats daarvan passen we width/height aan.
				// Dus left/top zijn in "gezoomde pixels".

				// Dus diffX moet * projectZoom.
				// Maar wacht, newX is berekend uit transformStart.x (wat style.left is).
				// style.left is in gezoomde pixels.
				// Dus newX is in gezoomde pixels.
				// canvasW is in ongezoomde pixels (want gedeeld door zoom).

				// Correctie: newX, newY, newW, newH zijn hierboven berekend in SCHERM pixels (gezoomd).
				// Zie: let newX = transformStart.x; (style.left)

				// Dus we moeten vergelijken met canvas midden in SCHERM pixels.
				const screenCanvasW = parseFloat(projectCanvasWrapper.style.width);
				const screenCanvasH = parseFloat(projectCanvasWrapper.style.height);
				const screenCenterX = screenCanvasW / 2;
				const screenCenterY = screenCanvasH / 2;

				const screenObjCenterX = finalLeft + newW / 2; // Gebruik finalLeft (gecorrigeerd voor rotatie)
				const screenObjCenterY = finalTop + newH / 2;

				if (Math.abs(screenObjCenterX - screenCenterX) < snapDist * projectZoom) {
					const shift = screenCenterX - screenObjCenterX;
					// Verschuif de uiteindelijke positie
					// finalLeft += shift; // Dit kan niet direct want finalLeft is const (in deze scope, of let?)
					// We moeten de variabele aanpassen die we straks toewijzen.
					// Maar finalLeft is berekend.
					// We passen de style direct aan bij toewijzing.

					if (guideV) guideV.style.display = "block";
					// We passen de berekende finalLeft aan voor de toewijzing
					// Hacky manier om const te omzeilen: nieuwe variabele of direct in style
					transformOverlay.style.left = finalLeft + shift + "px";
				} else {
					if (guideV) guideV.style.display = "none";
					transformOverlay.style.left = finalLeft + "px";
				}

				if (Math.abs(screenObjCenterY - screenCenterY) < snapDist * projectZoom) {
					const shift = screenCenterY - screenObjCenterY;
					if (guideH) guideH.style.display = "block";
					transformOverlay.style.top = finalTop + shift + "px";
				} else {
					if (guideH) guideH.style.display = "none";
					transformOverlay.style.top = finalTop + "px";
				}
			} else {
				// Geen snap check (of ver weg), gewoon toewijzen
				if (guideV) guideV.style.display = "none";
				if (guideH) guideH.style.display = "none";
				transformOverlay.style.left = finalLeft + "px";
				transformOverlay.style.top = finalTop + "px";
			}

			// Update Overlay
			// transformOverlay.style.left/top zijn hierboven al gedaan in de snap logica
			transformOverlay.style.width = newW + "px";
			transformOverlay.style.height = newH + "px";

			// Update Anchor positie (visueel blijft % hetzelfde, maar absolute positie verandert)
			// Geen actie nodig omdat anchor in % is

			// Update Layer Preview
			if (activeLayerId) {
				const layer = projectLayers.find((l) => l.id === activeLayerId);
				if (layer) {
					layer.canvas.style.left = transformOverlay.style.left;
					layer.canvas.style.top = transformOverlay.style.top;
					layer.canvas.style.width = newW + "px";
					layer.canvas.style.height = newH + "px";
					// Rotatie blijft behouden via transform
				}
			}
		} else if (isTransforming && transformMode === "move" && transformStart) {
			const dx = e.clientX - transformStart.mx;
			const dy = e.clientY - transformStart.my;

			let newX = transformStart.x + dx;
			let newY = transformStart.y + dy;

			// Snapping naar Canvas Midden
			const snapDist = 10;
			const guideV = document.getElementById("guideV");
			const guideH = document.getElementById("guideH");

			const currentW = parseFloat(transformOverlay.style.width);
			const currentH = parseFloat(transformOverlay.style.height);

			const screenCanvasW = parseFloat(projectCanvasWrapper.style.width);
			const screenCanvasH = parseFloat(projectCanvasWrapper.style.height);
			const screenCenterX = screenCanvasW / 2;
			const screenCenterY = screenCanvasH / 2;

			const objCenterX = newX + currentW / 2;
			const objCenterY = newY + currentH / 2;

			if (Math.abs(objCenterX - screenCenterX) < snapDist) {
				newX = screenCenterX - currentW / 2;
				if (guideV) guideV.style.display = "block";
			} else {
				if (guideV) guideV.style.display = "none";
			}

			if (Math.abs(objCenterY - screenCenterY) < snapDist) {
				newY = screenCenterY - currentH / 2;
				if (guideH) guideH.style.display = "block";
			} else {
				if (guideH) guideH.style.display = "none";
			}

			// Update overlay positie
			transformOverlay.style.left = newX + "px";
			transformOverlay.style.top = newY + "px";

			// Update ook de opgeslagen startpositie voor resize/rotate correcties als we doorgaan
			// (Niet strikt nodig voor move, maar wel voor consistentie)
			// transformStart.x = newX; ... nee, dat breekt de delta berekening

			if (activeLayerId) {
				const layer = projectLayers.find((l) => l.id === activeLayerId);
				if (layer) {
					layer.canvas.style.left = newX + "px";
					layer.canvas.style.top = newY + "px";
				}
			}
		} else if (isTransforming && transformMode === "rotate" && transformStart) {
			const currentAngle = (Math.atan2(e.clientY - transformStart.cy, e.clientX - transformStart.cx) * 180) / Math.PI;
			const deltaAngle = currentAngle - transformStart.startAngle;

			transformRotation = transformStart.initialRot + deltaAngle;

			const transformStr = `rotate(${transformRotation}deg)`;
			transformOverlay.style.transform = transformStr;

			if (activeLayerId) {
				const layer = projectLayers.find((l) => l.id === activeLayerId);
				if (layer) {
					layer.canvas.style.transform = transformStr;
					// Zorg dat origin matcht
					layer.canvas.style.transformOrigin = `${transformAnchor.x * 100}% ${transformAnchor.y * 100}%`;
				}
			}
		} else if (isTransforming && transformMode === "anchor" && transformStart) {
			// Bereken nieuwe anchor positie binnen de box
			// We moeten rekening houden met de huidige rotatie om de muis correct te projecteren?
			// Simpel: we bewegen het anker visueel met de muis mee.
			// Maar anchor is in %, dus we moeten delta omrekenen naar % van width/height.

			// Omdat de box geroteerd kan zijn, is dit complex.
			// Voor nu: simpele implementatie zonder rotatie-correctie voor anchor-slepen
			const dx = e.clientX - transformStart.mx;
			const dy = e.clientY - transformStart.my;

			const dPctX = dx / transformStart.w;
			const dPctY = dy / transformStart.h;

			transformAnchor.x = Math.max(0, Math.min(1, transformStart.ax + dPctX));
			transformAnchor.y = Math.max(0, Math.min(1, transformStart.ay + dPctY));

			const anchorEl = document.getElementById("transformAnchor");
			anchorEl.style.left = transformAnchor.x * 100 + "%";
			anchorEl.style.top = transformAnchor.y * 100 + "%";

			transformOverlay.style.transformOrigin = `${transformAnchor.x * 100}% ${transformAnchor.y * 100}%`;
		}
	});

	window.addEventListener("mouseup", () => {
		activeTransformHandle = null;
		transformMode = null;
		// Verberg guides
		const guideV = document.getElementById("guideV");
		const guideH = document.getElementById("guideH");
		if (guideV) guideV.style.display = "none";
		if (guideH) guideH.style.display = "none";
	});

	// ─────────────────────────────────────────────
	// 📁 PROJECT MENU LOGICA
	// ─────────────────────────────────────────────
	const projFileBtn = document.getElementById("projFileBtn");
	const projFileDropdown = document.getElementById("projFileDropdown");
	const projSaveBtn = document.getElementById("projSaveBtn");
	const projExportBtn = document.getElementById("projExportBtn");
	const projInsertBtn = document.getElementById("projInsertBtn");

	if (projFileBtn) {
		projFileBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			const isVisible = projFileDropdown.style.display === "flex";
			projFileDropdown.style.display = isVisible ? "none" : "flex";
		});
	}

	window.addEventListener("click", () => {
		if (projFileDropdown) projFileDropdown.style.display = "none";
	});

	// Opslaan naar Paper Menu (LocalStorage)
	if (projSaveBtn) {
		projSaveBtn.addEventListener("click", () => {
			const title = document.getElementById("projectTitle").textContent;
			const width = parseInt(projectCanvasWrapper.style.width);
			const height = parseInt(projectCanvasWrapper.style.height);

			// 1. Maak Thumbnail
			const thumbCanvas = document.createElement("canvas");
			const thumbSize = 120;
			thumbCanvas.width = thumbSize;
			thumbCanvas.height = thumbSize;
			const tCtx = thumbCanvas.getContext("2d");

			// Teken achtergrond (wit of patroon)
			tCtx.fillStyle = "#222"; // Donkere achtergrond voor thumbnail
			tCtx.fillRect(0, 0, thumbSize, thumbSize);

			// Schaal factor om project in thumbnail te passen (contain)
			const scale = Math.min(thumbSize / width, thumbSize / height);
			const drawW = width * scale;
			const drawH = height * scale;
			const drawX = (thumbSize - drawW) / 2;
			const drawY = (thumbSize - drawH) / 2;

			// Teken witte achtergrond voor het canvas gebied
			tCtx.fillStyle = "white";
			tCtx.fillRect(drawX, drawY, drawW, drawH);

			// Teken alle lagen
			// We moeten de lagen op volgorde tekenen (onderste eerst)
			[...projectLayers].forEach((layer) => {
				if (layer.visible) {
					tCtx.drawImage(layer.canvas, 0, 0, width, height, drawX, drawY, drawW, drawH);
				}
			});

			const thumbnailData = thumbCanvas.toDataURL();

			// 2. Verzamel Project Data
			const projectData = {
				id: Date.now().toString(),
				name: title,
				width: width,
				height: height,
				thumbnail: thumbnailData,
				background: projectCanvasWrapper.style.background,
				backgroundColor: projectCanvasWrapper.style.backgroundColor,
				backgroundSize: projectCanvasWrapper.style.backgroundSize,
				lastModified: Date.now(),
				layers: projectLayers.map((l) => ({
					name: l.name,
					visible: l.visible,
					x: l.x,
					y: l.y,
					width: l.canvas.width,
					height: l.canvas.height,
					data: l.canvas.toDataURL(), // Sla pixel data op
				})),
			};

			// 3. Sla op in LocalStorage
			try {
				let savedProjects = JSON.parse(localStorage.getItem("habboCloneSavedProjects")) || [];
				// Check of we een bestaand project updaten (op basis van naam voor nu, of ID als we dat hadden bijgehouden)
				// Voor nu voegen we gewoon toe of vervangen we als de naam exact hetzelfde is?
				// Laten we een nieuw item maken voor elke save om overschrijven te voorkomen, of filteren op naam.
				savedProjects = savedProjects.filter((p) => p.name !== title);
				savedProjects.unshift(projectData); // Nieuwste bovenaan

				localStorage.setItem("habboCloneSavedProjects", JSON.stringify(savedProjects));
				showNotification("Project opgeslagen in Paper!");
				renderPaperProjects(); // Ververs de lijst
			} catch (e) {
				console.error(e);
				showNotification("Opslaan mislukt! (Opslag vol?)");
			}
		});
	}

	// Exporteren naar JSON (Download)
	if (projExportBtn) {
		projExportBtn.addEventListener("click", () => {
			const projectData = {
				name: document.getElementById("projectTitle").textContent,
				width: parseInt(projectCanvasWrapper.style.width),
				height: parseInt(projectCanvasWrapper.style.height),
				background: projectCanvasWrapper.style.background,
				backgroundColor: projectCanvasWrapper.style.backgroundColor,
				backgroundSize: projectCanvasWrapper.style.backgroundSize,
				layers: projectLayers.map((l) => ({ name: l.name, visible: l.visible, x: l.x, y: l.y, data: l.canvas.toDataURL() })),
			};
			const blob = new Blob([JSON.stringify(projectData)], { type: "application/json" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = (projectData.name || "project") + ".json";
			a.click();
			URL.revokeObjectURL(url);
		});
	}

	// Invoegen (Afbeelding Uploaden)
	const projInsertInput = document.getElementById("projInsertInput");

	if (projInsertBtn) {
		projInsertBtn.addEventListener("click", () => {
			projInsertInput.click();
		});
	}

	if (projInsertInput) {
		projInsertInput.addEventListener("change", (e) => {
			const file = e.target.files[0];
			if (!file) return;

			const reader = new FileReader();
			reader.onload = (evt) => {
				const img = new Image();
				img.onload = () => {
					// Bereken afmetingen
					const canvasW = Math.round(parseFloat(projectCanvasWrapper.style.width) / projectZoom);
					const canvasH = Math.round(parseFloat(projectCanvasWrapper.style.height) / projectZoom);

					let drawW = img.width;
					let drawH = img.height;

					// Schaal omlaag als het groter is dan canvas (contain)
					if (drawW > canvasW || drawH > canvasH) {
						const scale = Math.min(canvasW / drawW, canvasH / drawH);
						drawW *= scale;
						drawH *= scale;
					}

					drawW = Math.round(drawW);
					drawH = Math.round(drawH);

					// Maak nieuwe laag met specifieke afmetingen
					const layer = addLayer(file.name, drawW, drawH);

					// Centreer laag op canvas
					layer.x = (canvasW - drawW) / 2;
					layer.y = (canvasH - drawH) / 2;

					// Update visuele positie
					layer.canvas.style.left = `${layer.x * projectZoom}px`;
					layer.canvas.style.top = `${layer.y * projectZoom}px`;

					layer.ctx.drawImage(img, 0, 0, drawW, drawH);

					// Update layer preview
					renderLayersList();
					showNotification(`Afbeelding "${file.name}" ingevoegd!`);
				};
				img.src = evt.target.result;
			};
			reader.readAsDataURL(file);
			projInsertInput.value = ""; // Reset
		});
	}

	// Instellingen Menu
	const projSettingsBtn = document.getElementById("projSettingsBtn");
	const projectSettingsModal = document.getElementById("projectSettingsModal");
	const closeProjSettings = document.getElementById("closeProjSettings");
	const setGuideColor = document.getElementById("setGuideColor");
	const setTransformColor = document.getElementById("setTransformColor");
	const setAnchorColor = document.getElementById("setAnchorColor");
	const projectWindowEl = document.getElementById("projectWindow");

	if (projSettingsBtn) {
		projSettingsBtn.addEventListener("click", () => {
			projectSettingsModal.style.display = "flex";
		});
	}
	if (closeProjSettings) {
		closeProjSettings.addEventListener("click", () => {
			projectSettingsModal.style.display = "none";
		});
	}
	if (setGuideColor) {
		setGuideColor.addEventListener("input", (e) => {
			projectWindowEl.style.setProperty("--proj-guide-color", e.target.value);
		});
	}
	if (setTransformColor) {
		setTransformColor.addEventListener("input", (e) => {
			projectWindowEl.style.setProperty("--proj-transform-color", e.target.value);
		});
	}
	if (setAnchorColor) {
		setAnchorColor.addEventListener("input", (e) => {
			projectWindowEl.style.setProperty("--proj-anchor-color", e.target.value);
		});
	}

	// Functie om Paper projecten te renderen
	function renderPaperProjects() {
		const grid = document.getElementById("paperGrid");
		if (!grid) return;
		grid.innerHTML = "";

		// 1. Nieuw Project Knop
		const newBtn = document.createElement("div");
		newBtn.className = "paper-item";
		newBtn.id = "newProjectBtn";
		newBtn.innerHTML = `
        <span style="font-size: 48px; line-height: 1; margin-bottom: 10px;">+</span>
        <span style="font-size: 10px;">Nieuw project</span>
    `;
		newBtn.onclick = () => {
			document.getElementById("paperWindow").style.display = "none";
			document.getElementById("newProjectWindow").style.display = "flex";
			bringToFront(document.getElementById("newProjectWindow"));
		};
		grid.appendChild(newBtn);

		// 2. Opgeslagen Projecten
		let savedProjects = [];
		try {
			savedProjects = JSON.parse(localStorage.getItem("habboCloneSavedProjects")) || [];
		} catch (e) {}

		savedProjects.forEach((proj) => {
			const item = document.createElement("div");
			item.className = "paper-item";
			item.style.backgroundImage = `url(${proj.thumbnail})`;
			item.style.backgroundSize = "cover";
			item.style.backgroundPosition = "center";
			item.style.position = "relative";

			// Overlay voor tekst
			const overlay = document.createElement("div");
			overlay.style.position = "absolute";
			overlay.style.bottom = "0";
			overlay.style.left = "0";
			overlay.style.width = "100%";
			overlay.style.background = "rgba(0,0,0,0.7)";
			overlay.style.padding = "5px";
			overlay.style.boxSizing = "border-box";
			overlay.style.borderBottomLeftRadius = "8px";
			overlay.style.borderBottomRightRadius = "8px";
			overlay.innerHTML = `<span style="font-size: 10px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${proj.name}</span>`;

			item.appendChild(overlay);

			// NIEUW: Verwijder knop
			const delBtn = document.createElement("div");
			delBtn.className = "paper-delete-btn";
			delBtn.innerHTML = "×";
			delBtn.title = "Project verwijderen";
			delBtn.onclick = (e) => {
				e.stopPropagation();
				showConfirmation({
					message: `Project "${proj.name}" verwijderen?`,
					icon: "icons/trash.png",
					onConfirm: () => {
						const newSaved = savedProjects.filter((p) => p.id !== proj.id);
						localStorage.setItem("habboCloneSavedProjects", JSON.stringify(newSaved));
						renderPaperProjects();
					},
				});
			};
			item.appendChild(delBtn);

			item.onclick = () => openSavedProject(proj);
			grid.appendChild(item);
		});
	}

	function openSavedProject(proj) {
		document.getElementById("paperWindow").style.display = "none";
		const projectWindow = document.getElementById("projectWindow");
		projectWindow.style.display = "flex";
		document.getElementById("projectTitle").textContent = proj.name;

		// Reset wrapper
		const mask = document.getElementById("projectClippingMask");
		if (mask) mask.innerHTML = "";

		// Reset zoom EERST
		projectZoom = 1;

		projectCanvasWrapper.style.width = proj.width + "px";
		projectCanvasWrapper.style.height = proj.height + "px";

		// Herstel achtergrond
		if (proj.background) projectCanvasWrapper.style.background = proj.background;
		if (proj.backgroundColor) projectCanvasWrapper.style.backgroundColor = proj.backgroundColor;
		if (proj.backgroundSize) projectCanvasWrapper.style.backgroundSize = proj.backgroundSize;

		// Reset lagen
		projectLayers = [];
		layerIdCounter = 0;

		// Herstel lagen
		proj.layers.forEach((lData) => {
			const layer = addLayer(lData.name, lData.width, lData.height);
			layer.visible = lData.visible;
			layer.x = lData.x || 0;
			layer.y = lData.y || 0;
			layer.canvas.style.display = layer.visible ? "block" : "none";

			// Laad image data
			const img = new Image();
			img.onload = () => {
				layer.ctx.drawImage(img, 0, 0);
			};
			img.src = lData.data;
		});

		updateProjectTransform();
	}

	// --- Marker Menu & Color Picker ---
	const markerMenu = document.getElementById("markerMenu");
	const markerColorPicker = new iro.ColorPicker("#marker-color-picker-container", {
		width: 160,
		color: markerColor,
		borderWidth: 1,
		borderColor: "#fff",
		layout: [{ component: iro.ui.Box }, { component: iro.ui.Slider, options: { sliderType: "hue" } }],
	});

	markerColorPicker.on("color:change", (color) => {
		markerColor = color.hexString;
		document.getElementById("markerColorPreview").style.backgroundColor = markerColor;
		document.getElementById("markerHexInput").value = markerColor;
	});

	document.getElementById("closeMarkerMenuBtn").addEventListener("click", () => {
		markerMenu.style.display = "none";
		isMarkerMode = false;
		document.querySelector("#markerBtn img").src = "icons/marker.png";
	});

	// Marker Tool Switching
	const markerToolDraw = document.getElementById("markerToolDraw");
	const markerToolErase = document.getElementById("markerToolErase");

	if (markerToolDraw && markerToolErase) {
		markerToolDraw.addEventListener("click", () => {
			markerTool = "draw";
			markerToolDraw.querySelector("img").src = "icons/marker_active.png";
			markerToolErase.querySelector("img").src = "icons/eraser.png";
		});
		markerToolErase.addEventListener("click", () => {
			markerTool = "erase";
			markerToolDraw.querySelector("img").src = "icons/marker.png";
			markerToolErase.querySelector("img").src = "icons/eraser_active.png";
		});
	}

	// Marker Size Slider
	const markerSizeSlider = document.getElementById("markerSizeSlider");
	const markerSizeLabel = document.getElementById("markerSizeLabel");
	if (markerSizeSlider) {
		markerSizeSlider.addEventListener("input", (e) => {
			markerSize = parseInt(e.target.value);
			if (markerSizeLabel) markerSizeLabel.textContent = markerSize;
		});
	}

	// Marker knop logica
	const markerBtn = document.getElementById("markerBtn");
	if (markerBtn) {
		markerBtn.addEventListener("click", () => {
			const img = markerBtn.querySelector("img");
			if (markerMenu.style.display === "flex") {
				markerMenu.style.display = "none";
				img.src = "icons/marker.png";
				isMarkerMode = false;
			} else {
				markerMenu.style.display = "flex";
				img.src = "icons/marker_active.png";
				isMarkerMode = true;
				bringToFront(markerMenu);
			}
		});
	}

	// Vicinity knop logica (visueel)
	const vicinityBtn = document.getElementById("vicinityBtn");
	if (vicinityBtn) {
		vicinityBtn.addEventListener("click", () => {
			if (vicinityWindow.style.display === "flex") {
				vicinityWindow.style.display = "none";
				vicinityBtn.querySelector("img").src = "icons/vicinity.png";
				if (vicinityInterval) clearInterval(vicinityInterval);
			} else {
				vicinityWindow.style.display = "flex";
				vicinityBtn.querySelector("img").src = "icons/vicinity_active.png";
				renderVicinityItems();
				vicinityInterval = setInterval(renderVicinityItems, 500); // Update elke 500ms
			}
		});
	}

	// NIEUW: Functie om de hoogte van het oppervlak op een tegel te bepalen
	function getSurfaceHeight(x, y) {
		// Zoek het hoogste object op deze tegel
		const obj = objects.find((o) => {
			if (o.isFloor) return false; // Vloeren tellen als 0
			if (o.isWall) return false; // NIEUW: Muren negeren voor hoogte
			const w = o.flipped ? o.depth || 1 : o.width || 1;
			const d = o.flipped ? o.width || 1 : o.depth || 1;
			return x >= o.x && x < o.x + w && y >= o.y && y < o.y + d;
		});
		if (obj) {
			return (obj.height || 1) * 32; // 32 pixels per hoogte-eenheid
		}
		return 0; // Grond
	}

	// Collision check
	function isBlocked(x, y, ignoreWalls = false) {
		// Player kan niet op object tile staan
		return objects.some((o) => {
			if (o.isFloor) return false; // Vloer objecten blokkeren niet
			if (ignoreWalls && o.isWall) return false; // NIEUW: Negeer muren indien gevraagd (voor plaatsing)
			if (o.isGate) return false; // NIEUW: Poorten blokkeren niet
			const w = o.flipped ? o.depth || 1 : o.width || 1;
			const d = o.flipped ? o.width || 1 : o.depth || 1;
			// Check of x,y binnen de bounding box van het object valt
			return x >= o.x && x < o.x + w && y >= o.y && y < o.y + d;
		});
	}

	// NIEUW: Check of een tegel bezet is door een item (exclusief het item dat we nu slepen)
	function isItemOccupied(x, y) {
		return items.some((item) => item !== draggedItem && Math.floor(item.x) === x && Math.floor(item.y) === y);
	}

	// NIEUW: checkPlacement globaal gemaakt en aangepast om muren te negeren
	const checkPlacement = (bx, by, obj, flipped) => {
		const w = flipped ? obj.depth || 1 : obj.width || 1;
		const d = flipped ? obj.width || 1 : obj.depth || 1;
		for (let dx = 0; dx < w; dx++) {
			for (let dy = 0; dy < d; dy++) {
				const tx = bx + dx;
				const ty = by + dy;
				if (tx >= mapW || ty >= mapH) return false;
				if (!obj.isFloor && (isBlocked(tx, ty, true) || (Math.floor(ball.x) === tx && Math.floor(ball.y) === ty))) return false;
			}
		}
		return true;
	};

	// Bouwmodus logica
	const buildBtn = document.getElementById("buildBtn");
	const buildMenu = document.getElementById("buildMenu");
	const buildCategoryMenu = document.getElementById("buildCategoryMenu");
	const buildMenuContent = document.getElementById("buildMenuContent");

	const buildableObjects = [
		// Admin/Template Objects
		// subCategory: 'objects' (was blok)
		{
			name: "Blok",
			height: 1,
			image: objectImg.src,
			category: "objecten",
			subCategory: "objects",
			placement: "floor",
			isTemplate: true,
			price: 10,
		},
		{
			name: "Hoge Blok",
			height: 2,
			image: objectImg96.src,
			category: "objecten",
			subCategory: "objects",
			placement: "floor",
			isTemplate: true,
			price: 20,
		},
		{
			name: "Tafel",
			height: 1,
			width: 2,
			depth: 1,
			image: objectImg96B.src,
			category: "objecten",
			subCategory: "objects",
			placement: "floor",
			isTemplate: true,
			price: 50,
		},
		{
			name: "Kraan",
			height: 1,
			image: kraanImg.src,
			category: "objecten",
			subCategory: "objects",
			placement: "floor",
			isTemplate: true,
			price: 50,
			interactionType: "tap",
		},
		{
			name: "Hoge Kraan",
			height: 2,
			image: kraanImg96.src,
			category: "objecten",
			subCategory: "objects",
			placement: "floor",
			isTemplate: true,
			price: 75,
			interactionType: "tap",
		},
		{
			name: "Pong",
			height: 1,
			width: 2,
			depth: 1,
			image: pongImg.src,
			category: "objecten",
			subCategory: "objects",
			placement: "floor",
			isTemplate: true,
			price: 1000,
			interactionType: "pong",
		},

		// subCategory: 'moveable'
		{
			name: "Verplaatsbaar Blok",
			height: 1,
			image: moveableObjectImg.src,
			category: "objecten",
			subCategory: "moveable",
			placement: "floor",
			moveable: true,
			isTemplate: true,
			price: 30,
		},
		{
			name: "Verplaatsbare Tafel",
			height: 1,
			width: 2,
			depth: 1,
			image: moveableObjectImg96B.src,
			category: "objecten",
			subCategory: "moveable",
			placement: "floor",
			moveable: true,
			isTemplate: true,
			price: 75,
		},

		// subCategory: 'shop'
		{
			name: "Winkel",
			height: 2,
			image: winkelImg.src,
			category: "objecten",
			subCategory: "shop",
			placement: "floor",
			isTemplate: true,
			price: 500,
		},
		{
			name: "Brede Winkel",
			height: 1,
			width: 2,
			depth: 1,
			image: winkelImg96B.src,
			category: "objecten",
			subCategory: "shop",
			placement: "floor",
			isTemplate: true,
			price: 750,
		},

		// subCategory: 'containers'
		{
			name: "Container",
			height: 1,
			image: containerImg.src,
			category: "objecten",
			subCategory: "containers",
			placement: "floor",
			isTemplate: true,
			price: 100,
		},
		{
			name: "Grote Container",
			height: 2,
			image: containerImg96.src,
			category: "objecten",
			subCategory: "containers",
			placement: "floor",
			isTemplate: true,
			price: 200,
		},
		{
			name: "Brede Container",
			height: 1,
			width: 2,
			depth: 1,
			image: containerImg96B.src,
			category: "objecten",
			subCategory: "containers",
			placement: "floor",
			isTemplate: true,
			price: 150,
		},

		// subCategory: 'trash'
		{
			name: "Prullenbak",
			height: 1,
			image: trashImg.src,
			category: "objecten",
			subCategory: "trash",
			placement: "floor",
			isTemplate: true,
			price: 25,
		},
		{
			name: "Brede Prullenbak",
			height: 1,
			width: 2,
			depth: 1,
			image: trashImg96B.src,
			category: "objecten",
			subCategory: "trash",
			placement: "floor",
			isTemplate: true,
			price: 40,
		},

		// subCategory: 'wall' (was muur)
		{
			name: "Muurdecoratie",
			image: wallItemImg.src,
			category: "objecten",
			subCategory: "wall",
			placement: "wall",
			isTemplate: true,
			price: 15,
		},
		{
			name: "Brede Muurdecoratie",
			image: wallItem2Img.src,
			category: "objecten",
			subCategory: "wall",
			placement: "wall",
			isTemplate: true,
			price: 30,
			width: 2,
		},
		{
			name: "Vrije Muurdecoratie",
			image: wallFreeImg.src,
			category: "objecten",
			subCategory: "wall",
			placement: "wall",
			isTemplate: true,
			price: 20,
			isFree: true,
		},
		{
			name: "Brede Vrije Muurdecoratie",
			image: wallFree2Img.src,
			category: "objecten",
			subCategory: "wall",
			placement: "wall",
			isTemplate: true,
			price: 40,
			isFree: true,
			width: 2,
		},
		{
			name: "Muur",
			image: "icons/wall_build.png",
			category: "objecten",
			subCategory: "wall",
			placement: "wall_structure",
			isTemplate: false,
			price: 50,
			wallHeight: 150,
			wallThickness: 0.25,
		},
		{
			name: "Muur",
			image: "icons/wall_build.png",
			category: "objecten",
			subCategory: "wall",
			placement: "wall_structure",
			isTemplate: true,
			price: 50,
			wallHeight: 150,
			wallThickness: 0.25,
		},
		{
			name: "Muur met Poort (3x)",
			image: "icons/portier_build.png",
			category: "objecten",
			subCategory: "wall",
			placement: "wall_structure",
			isTemplate: false,
			price: 150,
			wallHeight: 150,
			wallThickness: 0.25,
			width: 3,
		},
		{
			name: "Muur met Poort (3x)",
			image: "icons/portier_build.png",
			category: "objecten",
			subCategory: "wall",
			placement: "wall_structure",
			isTemplate: true,
			price: 150,
			wallHeight: 150,
			wallThickness: 0.25,
			width: 3,
		},

		// subCategory: 'floor'
		{
			name: "Vloer",
			image: floorImg.src,
			category: "objecten",
			subCategory: "floor",
			placement: "floor",
			isTemplate: true,
			price: 5,
			isFloor: true,
		},

		// NIEUW: Item Spawns (Items die je kunt plaatsen als objecten)
		// subCategory: 'items'
		{
			name: "Bal Spawn",
			image: itemRoundImg.src,
			category: "objecten",
			subCategory: "items",
			placement: "floor",
			isItem: true,
			itemType: "ball",
			mass: 0.8,
			canRotate: true,
			price: 5,
			isTemplate: true,
		},
		{
			name: "Blok Item",
			image: itemImg.src,
			category: "objecten",
			subCategory: "items",
			placement: "floor",
			isItem: true,
			itemType: "block",
			mass: 1.2,
			price: 5,
			isTemplate: true,
		},
		{
			name: "Pouch",
			image: itemContainerImg.src,
			category: "objecten",
			subCategory: "items",
			placement: "floor",
			isItem: true,
			itemType: "pouch",
			isPouch: true,
			mass: 1.0,
			price: 50,
			isTemplate: true,
		},
		{
			name: "Stok Item",
			image: itemStickImg.src,
			category: "objecten",
			subCategory: "items",
			placement: "floor",
			isItem: true,
			itemType: "stick",
			mass: 0.4,
			canTopple: true,
			price: 2,
			isTemplate: true,
		},
		{
			name: "Geld (Klein)",
			image: currencyItemImg.src,
			category: "objecten",
			subCategory: "items",
			placement: "floor",
			isItem: true,
			itemType: "currency",
			mass: 0.5,
			price: 100,
			isTemplate: true,
		},
		{
			name: "Geld (Groot)",
			image: currencyItemBigImg.src,
			category: "objecten",
			subCategory: "items",
			placement: "floor",
			isItem: true,
			itemType: "currency_big",
			mass: 0.5,
			price: 500,
			isTemplate: true,
		},
		{
			name: "Batje Rood",
			image: batjeRoodImg.src,
			category: "objecten",
			subCategory: "items",
			placement: "floor",
			isItem: true,
			itemType: "bat_red",
			mass: 0.4,
			canTopple: true,
			price: 15,
			isTemplate: true,
		},
		{
			name: "Batje Zwart",
			image: batjeZwartImg.src,
			category: "objecten",
			subCategory: "items",
			placement: "floor",
			isItem: true,
			itemType: "bat_black",
			mass: 0.4,
			canTopple: true,
			price: 15,
			isTemplate: true,
		},
		{
			name: "Pakje sigaretten",
			image: sigarettenContainerImg.src,
			category: "objecten",
			subCategory: "items",
			placement: "floor",
			isItem: true,
			itemType: "sigaretten_container",
			isPouch: true,
			mass: 0.2,
			price: 12,
			isTemplate: true,
		},
		{
			name: "Sigaret",
			image: sigaretStickImg.src,
			category: "objecten",
			subCategory: "items",
			placement: "floor",
			isItem: true,
			itemType: "sigaret",
			mass: 0.05,
			canTopple: true,
			price: 1,
			isTemplate: true,
		},
		{
			name: "Aansteker",
			image: aanstekerStickImg.src,
			category: "objecten",
			subCategory: "items",
			placement: "floor",
			isItem: true,
			itemType: "aansteker",
			mass: 0.1,
			canTopple: true,
			price: 2,
			isTemplate: true,
			uses: 50,
		},
		{
			name: "Flesje water",
			image: bottleFullImg.src,
			category: "objecten",
			subCategory: "items",
			placement: "floor",
			isItem: true,
			itemType: "bottle_full",
			mass: 1.2,
			price: 3,
			isTemplate: true,
		},
	];

	function renderBuildItems() {
		const moveToolBtn = document.getElementById("moveToolBtn");
		const deleteToolBtn = document.getElementById("deleteToolBtn");

		const searchInput = document.getElementById("buildSearchInput");
		const sortSelect = document.getElementById("buildSortSelect");
		const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";
		const sortMode = sortSelect ? sortSelect.value : "name_asc";

		buildMenuContent.innerHTML = ""; // Maak de lijst leeg
		let itemsToShow = buildableObjects.filter((item) => {
			const isTemplate = !!item.isTemplate; // Convert undefined to false

			let contextMatch;
			if (item.isCustom) {
				// Custom items: als adminOnly true is, alleen zichtbaar voor admin. Anders voor iedereen.
				contextMatch = item.adminOnly ? activeMenuContext === "admin" : true;
			} else {
				// Standaard items: Admin ziet templates, Speler ziet niet-templates
				contextMatch = activeMenuContext === "admin" ? isTemplate : !isTemplate;
			}

			const categoryMatch = item.category === activeBuildCategory && item.subCategory === activeObjectSubCategory;
			const nameMatch = item.name.toLowerCase().includes(searchTerm);
			const keywordMatch = item.keywords && item.keywords.some((k) => k.toLowerCase().includes(searchTerm));

			return contextMatch && categoryMatch && (nameMatch || keywordMatch);
		});

		// Sorteren
		itemsToShow.sort((a, b) => {
			switch (sortMode) {
				case "name_asc":
					return a.name.localeCompare(b.name);
				case "name_desc":
					return b.name.localeCompare(a.name);
				case "price_asc":
					return (a.price || 0) - (b.price || 0);
				case "price_desc":
					return (b.price || 0) - (a.price || 0);
				default:
					return 0;
			}
		});

		itemsToShow.forEach((item) => {
			const div = document.createElement("div");
			div.className = "build-item";
			let priceHtml = "";
			if (!isUserAdmin && item.price !== undefined) {
				priceHtml = `<div style="color: #7bff00; font-size: 10px;">€${item.price}</div>`;
			}
			div.innerHTML = `<img src="${item.image}" alt="${item.name}"><div style="text-align: center; width: 100%; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.name}</div>${priceHtml}`;

			// NIEUW: Delete knop voor admins bij custom objecten
			if (activeMenuContext === "admin" && item.isCustom) {
				const delBtn = document.createElement("span");
				delBtn.innerHTML = "×";
				delBtn.style.position = "absolute";
				delBtn.style.top = "2px";
				delBtn.style.right = "2px";
				delBtn.style.color = "white";
				delBtn.style.background = "red";
				delBtn.style.borderRadius = "50%";
				delBtn.style.width = "18px";
				delBtn.style.height = "18px";
				delBtn.style.display = "flex";
				delBtn.style.alignItems = "center";
				delBtn.style.justifyContent = "center";
				delBtn.style.cursor = "pointer";
				delBtn.onclick = (e) => {
					e.stopPropagation();
					if (confirm(`Wil je "${item.name}" definitief verwijderen? Dit verwijdert het ook bij alle spelers en geeft geld terug.`)) {
						socket.emit("deleteCustomObject", item.name);
					}
				};

				// NIEUW: Edit knop (Wit met +)
				const editBtn = document.createElement("span");
				editBtn.innerHTML = "+";
				editBtn.style.position = "absolute";
				editBtn.style.top = "2px";
				editBtn.style.right = "24px"; // Links van de delete knop
				editBtn.style.color = "black";
				editBtn.style.background = "white";
				editBtn.style.borderRadius = "50%";
				editBtn.style.width = "18px";
				editBtn.style.height = "18px";
				editBtn.style.display = "flex";
				editBtn.style.alignItems = "center";
				editBtn.style.justifyContent = "center";
				editBtn.style.cursor = "pointer";
				editBtn.style.fontWeight = "bold";
				editBtn.title = "Bewerken";
				editBtn.onclick = (e) => {
					e.stopPropagation();
					openEditModal(item);
				};

				div.style.position = "relative";
				div.appendChild(editBtn);
				div.appendChild(delBtn);
			}

			div.onclick = () => {
				// Activeer 'place' tool
				setBuildTool("place");

				// Deselecteer als het al geselecteerd was
				if (selectedBuildObject && selectedBuildObject.name === item.name) {
					selectedBuildObject = null;
					div.classList.remove("selected");
				} else {
					// Deselecteer tools
					moveToolBtn.classList.remove("selected");
					deleteToolBtn.classList.remove("selected");
					// Deselecteer andere items
					document.querySelectorAll(".build-item.selected").forEach((el) => el.classList.remove("selected"));
					// Selecteer dit item
					selectedBuildObject = item;
					div.classList.add("selected");
					isBuildObjectFlipped = false; // Reset flip state bij nieuwe selectie
				}
			};
			buildMenuContent.appendChild(div);
		});
	}

	// Event listeners voor zoekbalk en sorteren in bouwmenu
	document.getElementById("buildSearchInput").addEventListener("input", renderBuildItems);
	document.getElementById("buildSortSelect").addEventListener("change", renderBuildItems);

	function renderObjectSubCategories() {
		const subCategoryMenu = document.getElementById("objectSubCategoryMenu");
		subCategoryMenu.innerHTML = ""; // Leegmaken

		// Verzamel unieke subcategorieën
		const foundCategories = buildableObjects
			.filter((item) => {
				if (item.category !== "objecten") return false;
				if (item.subCategory === "items" && activeMenuContext !== "admin") return false;
				return true;
			})
			.map((item) => item.subCategory);

		// Voeg 'wall' altijd toe zodat de categorie zichtbaar blijft
		const subCategories = [...new Set([...foundCategories, "wall"])];

		// Maak voor elke subcategorie een knop
		subCategories.forEach((subCat) => {
			const btn = document.createElement("button");
			btn.className = "category-btn"; // Gebruik dezelfde styling
			if (subCat === activeObjectSubCategory) {
				btn.classList.add("selected");
			}
			btn.dataset.subCategory = subCat;
			btn.title = subCat.charAt(0).toUpperCase() + subCat.slice(1); // bv. 'Blok'
			// Kies een icoon op basis van de subcategorie
			const isActive = subCat === activeObjectSubCategory;
			if (subCat === "objects") {
				btn.innerHTML = `<img src="icons/object${isActive ? "_active" : ""}.png">`;
			} else if (subCat === "wall") {
				btn.innerHTML = `<img src="icons/wall${isActive ? "_active" : ""}.png">`;
			} else if (subCat === "floor") {
				btn.innerHTML = `<img src="icons/floor${isActive ? "_active" : ""}.png">`;
			} else if (subCat === "items") {
				btn.innerHTML = `<img src="icons/items${isActive ? "_active" : ""}.png">`;
			} else if (subCat === "moveable") {
				btn.innerHTML = `<img src="icons/moveable${isActive ? "_active" : ""}.png">`;
			} else if (subCat === "shop") {
				btn.innerHTML = `<img src="icons/winkel${isActive ? "_active" : ""}.png">`;
			} else if (subCat === "containers") {
				btn.innerHTML = `<img src="icons/inventory${isActive ? "_active" : ""}.png">`;
			} else if (subCat === "trash") {
				btn.innerHTML = `<img src="icons/trash_buildmenu${isActive ? "_active" : ""}.png">`;
			} else {
				// Fallback icoon voor nieuwe categorieën (moveable, shop, etc.)
				// Je kunt hier specifieke iconen toevoegen zoals 'icons/shop.png' als je die hebt.
				btn.innerHTML = `<img src="icons/object${isActive ? "_active" : ""}.png">`;
			}

			btn.onclick = () => {
				activeObjectSubCategory = subCat;
				renderObjectSubCategories(); // Her-render om selectie te tonen
				renderBuildItems(); // Her-render de items in de grid
			};
			subCategoryMenu.appendChild(btn);
		});
	}

	function setBuildTool(tool) {
		buildTool = tool;

		// NIEUW: Reset iconen als we terugkeren naar 'place' (standaard) modus
		if (tool === "place") {
			const mBtn = document.getElementById("moveToolBtn");
			const dBtn = document.getElementById("deleteToolBtn");
			if (mBtn) {
				const img = mBtn.querySelector("img");
				if (img) img.src = "icons/place.png";
			}
			if (dBtn) {
				const img = dBtn.querySelector("img");
				if (img) img.src = "icons/trash.png";
			}
			const wpBtn = document.getElementById("wallPlaceToolBtn");
			if (wpBtn) {
				wpBtn.querySelector("img").src = "icons/wall_build.png";
			}
		}

		// Deselecteer meubel als we een andere tool kiezen
		if (tool === "move" || tool === "delete") {
			selectedBuildObject = null;
			document.querySelectorAll(".build-item.selected").forEach((el) => el.classList.remove("selected"));
		}

		// Annuleer altijd een 'move' actie als we een andere tool selecteren
		if (movingObject) {
			objects.push(movingObject); // Zet het object terug
			movingObject = null;
		}
	}

	moveToolBtn.addEventListener("click", () => {
		const img = moveToolBtn.querySelector("img");
		if (buildTool === "move") {
			setBuildTool("place"); // Terug naar neutraal
			img.src = "icons/place.png";
		} else {
			setBuildTool("move");
			closeSecondaryWindows(); // Sluit andere vensters om conflicten te voorkomen
			img.src = "icons/place_active.png";
			deleteToolBtn.querySelector("img").src = "icons/trash.png"; // Reset delete
		}
	});

	deleteToolBtn.addEventListener("click", () => {
		const img = deleteToolBtn.querySelector("img");
		setBuildTool(buildTool === "delete" ? "place" : "delete");
		img.src = buildTool === "delete" ? "icons/trash_active.png" : "icons/trash.png";
		moveToolBtn.querySelector("img").src = "icons/place.png"; // Reset move
	});

	// --- Kruisjes om menu's te sluiten ---
	document.getElementById("closeBuildMenuBtn").addEventListener("click", () => {
		closeBuildAdminMenu();
	});

	document.getElementById("closeChatLogBtn").addEventListener("click", () => {
		chatLog.style.display = "none";
		document.querySelector("#openChatLog img").src = "icons/chat.png";
	});

	document.getElementById("closeInventoryBtn").addEventListener("click", () => {
		inventory.style.display = "none";
		document.querySelector("#inventoryBtn img").src = "icons/inventory.png";

		document.getElementById("vicinityWindow").style.display = "none";
		if (vicinityInterval) clearInterval(vicinityInterval);
		document.querySelector("#vicinityBtn img").src = "icons/vicinity.png";

		const markerImg = document.querySelector("#markerBtn img");
		if (markerImg) markerImg.src = "icons/marker.png";

		const paperImg = document.querySelector("#paperBtn img");
		if (paperImg) paperImg.src = "icons/paper.png";
		document.getElementById("paperWindow").style.display = "none";
		document.getElementById("newProjectWindow").style.display = "none";
	});

	buildCategoryMenu.addEventListener("click", (e) => {
		const btn = e.target.closest(".category-btn");
		if (btn) {
			// Verwijder 'selected' van alle categorieknoppen
			buildCategoryMenu.querySelectorAll(".category-btn").forEach((b) => {
				b.classList.remove("selected");
				// Reset iconen naar inactive
				const img = b.querySelector("img");
				if (img) {
					if (b.dataset.category === "objecten") img.src = "icons/object.png";
					if (b.dataset.category === "kleur") img.src = "icons/color.png";
					if (b.dataset.category === "kamers") img.src = "icons/new_room.png";
					if (b.dataset.category === "weer") img.src = "icons/zon.png";
				}
			});
			// Deselecteer de losse tools
			setBuildTool("place");

			// Reset tool icons
			document.querySelector("#moveToolBtn img").src = "icons/place.png";
			document.querySelector("#deleteToolBtn img").src = "icons/trash.png";

			// Annuleer een eventuele 'move' actie
			if (movingObject) {
				objects.push(movingObject); // Zet het object terug
				movingObject = null;
			}

			// Annuleer ook een 'place' actie (deselecteer object)
			if (selectedBuildObject) {
				selectedBuildObject = null;
				document.querySelectorAll(".build-item.selected").forEach((el) => el.classList.remove("selected"));
				isBuildObjectFlipped = false;
			}

			// Voeg 'selected' toe aan de geklikte knop
			btn.classList.add("selected");
			activeBuildCategory = btn.dataset.category;

			// Set active icon
			const activeImg = btn.querySelector("img");
			if (activeImg) {
				if (activeBuildCategory === "objecten") activeImg.src = "icons/object_active.png";
				if (activeBuildCategory === "kleur") activeImg.src = "icons/color_active.png";
				if (activeBuildCategory === "kamers") activeImg.src = "icons/new_room_active.png";
				if (activeBuildCategory === "weer") activeImg.src = "icons/zon_active.png";
			}

			// Wissel de zichtbare content
			document.getElementById("objectCategoryView").style.display = activeBuildCategory === "objecten" ? "flex" : "none";
			document.getElementById("colorCategoryView").style.display = activeBuildCategory === "kleur" ? "flex" : "none";
			document.getElementById("roomCategoryView").style.display = activeBuildCategory === "kamers" ? "block" : "none";
			document.getElementById("weatherCategoryView").style.display = activeBuildCategory === "weer" ? "block" : "none";

			if (activeBuildCategory === "objecten") {
				renderObjectSubCategories(); // Render de subcategorie-knoppen
				renderBuildItems(); // Render de items voor de actieve subcategorie
			} else if (activeBuildCategory === "kamers") {
				// Vraag de server om de lijst met kamers
				if (socket) socket.emit("getRooms");
			}
		}
	});

	// Weer knoppen logica (Weer)
	document.querySelectorAll(".weather-btn").forEach((btn) => {
		btn.addEventListener("click", () => {
			const type = btn.dataset.weather;
			const urlParams = new URLSearchParams(window.location.search);
			const roomId = urlParams.get("room") || "testroom";
			if (socket) socket.emit("setRoomWeather", { roomId: roomId, weather: type });

			// Visuele feedback
			document.querySelectorAll(".weather-btn").forEach((b) => (b.style.borderColor = "#555"));
			btn.style.borderColor = "#7bff00";
			showNotification(`Weer ingesteld op: ${btn.title}`);
		});
	});

	// Tijd knoppen logica (Dag/Nacht)
	document.querySelectorAll(".time-btn").forEach((btn) => {
		btn.addEventListener("click", () => {
			const type = btn.dataset.time;
			const urlParams = new URLSearchParams(window.location.search);
			const roomId = urlParams.get("room") || "testroom";
			if (socket) socket.emit("setRoomTime", { roomId: roomId, time: type });

			// Visuele feedback
			document.querySelectorAll(".time-btn").forEach((b) => (b.style.borderColor = "#555"));
			btn.style.borderColor = "#7bff00";
			showNotification(`Tijd ingesteld op: ${btn.title}`);
		});
	});

	// --- Logica voor Kleur-tools ---
	const colorToolsContainer = document.getElementById("colorTools");
	colorToolsContainer.addEventListener("click", (e) => {
		const clickedButton = e.target.closest(".tool-btn");
		if (!clickedButton) return;

		// Update de geselecteerde tool
		colorTool = clickedButton.dataset.tool;

		// Update de visuele selectie
		colorToolsContainer.querySelectorAll(".tool-btn").forEach((btn) => {
			btn.classList.remove("selected");
			// Reset icons
			const img = btn.querySelector("img");
			if (btn.dataset.tool === "brush") img.src = "icons/paint.png";
			if (btn.dataset.tool === "bucket") img.src = "icons/fill.png";
			if (btn.dataset.tool === "picker") img.src = "icons/pipet.png";
		});
		clickedButton.classList.add("selected");
		// Set active icon
		const activeImg = clickedButton.querySelector("img");
		if (colorTool === "brush") activeImg.src = "icons/paint_active.png";
		if (colorTool === "bucket") activeImg.src = "icons/fill_active.png";
		if (colorTool === "picker") activeImg.src = "icons/pipet_active.png";
	});

	// --- iro.js Color Picker Initialisatie ---
	const colorPicker = new iro.ColorPicker("#color-picker-container", {
		width: 280, // Iets kleiner voor betere centrering
		color: selectedColor,
		borderWidth: 1,
		borderColor: "#fff",
		layout: [
			{
				component: iro.ui.Box, // Het vierkante kleurvlak
			},
			{
				component: iro.ui.Slider, // De slider voor de kleurtint
				options: { sliderType: "hue" },
			},
		],
	});

	// Update de 'selectedColor' variabele wanneer de kleur verandert
	function updateColor(color, source) {
		selectedColor = color.hexString;
		document.getElementById("colorPreview").style.backgroundColor = selectedColor;

		// Voorkom een oneindige loop door niet te updaten als de input de bron was
		if (source !== "input") {
			document.getElementById("hexInput").value = selectedColor;
		}
	}

	colorPicker.on("color:change", (color) => updateColor(color, "picker"));

	document.getElementById("hexInput").addEventListener("change", (e) => {
		const hex = e.target.value;
		// Simpele validatie voor een hex kleur
		if (/^#([0-9A-F]{3}){1,2}$/i.test(hex)) {
			colorPicker.color.hexString = hex;
			// De 'color:change' event van de picker wordt automatisch getriggerd,
			// dus we hoeven updateColor() hier niet expliciet aan te roepen.
		}
	});

	const adminBtn = document.getElementById("adminBtn");
	const buildMenuHeaderSpan = buildMenu.querySelector("#buildMenuHeader span");

	function closeBuildAdminMenu() {
		isBuildMode = false;
		buildMenu.style.display = "none";

		// Reset icons
		buildBtn.querySelector("img").src = "icons/buildmenu.png";
		adminBtn.querySelector("img").src = "icons/admin.png";

		// Cleanup logic
		selectedBuildObject = null;
		document.querySelectorAll(".build-item.selected").forEach((el) => el.classList.remove("selected"));
		isBuildObjectFlipped = false;
		setBuildTool("place");
		document.querySelector("#moveToolBtn img").src = "icons/place.png";
		document.querySelector("#deleteToolBtn img").src = "icons/trash.png";

		// Reset to objecten categorie for the next time
		const objBtn = document.querySelector('.category-btn[data-category="objecten"]'); // Default naar objects/blok
		if (objBtn) objBtn.click();
	}

	function openBuildAdminMenu(context) {
		// If we click the same button again while the menu is open, close it.
		if (isBuildMode && activeMenuContext === context) {
			closeBuildAdminMenu();
			return;
		}

		isBuildMode = true;
		activeMenuContext = context;
		buildMenu.style.display = "flex";

		// Update header text
		buildMenuHeaderSpan.textContent = context === "admin" ? "Admin" : "Bouwmodus";

		// Update button icons
		buildBtn.querySelector("img").src = context === "player" ? "icons/buildmenu_active.png" : "icons/buildmenu.png";
		adminBtn.querySelector("img").src = context === "admin" ? "icons/admin_active.png" : "icons/admin.png";

		// Toon/verberg de kamers knop
		const roomBtn = document.getElementById("adminRoomBtn");
		if (roomBtn) {
			roomBtn.style.display = context === "admin" ? "flex" : "none";
		}

		const weatherBtn = document.getElementById("adminWeatherBtn");
		if (weatherBtn) {
			weatherBtn.style.display = context === "admin" ? "flex" : "none";
		}

		const uploadBtn = document.getElementById("uploadToolBtn");
		if (uploadBtn) {
			uploadBtn.style.display = context === "admin" ? "flex" : "none";
		}

		// Render content for the new context
		// Reset subcategory to 'objects' (was blok) when opening menu to ensure valid state
		activeObjectSubCategory = "objects";

		const activeCatBtn = document.querySelector('.category-btn[data-category="objecten"]');
		if (activeCatBtn) {
			activeCatBtn.click(); // Trigger click to refresh view
		}
	}

	buildBtn.addEventListener("click", () => openBuildAdminMenu("player"));
	adminBtn.addEventListener("click", () => openBuildAdminMenu("admin"));

	document.getElementById("createRoomBtn").addEventListener("click", () => {
		const roomNameInput = document.getElementById("roomNameInput");
		const roomName = roomNameInput.value.trim();
		const w = parseInt(document.getElementById("roomWidthInput").value) || 10;
		const h = parseInt(document.getElementById("roomHeightInput").value) || 10;
		const selectedSize = `${w}x${h}`;
		const alwaysOnline = document.getElementById("adminAlwaysOnlineToggle").dataset.active === "true";
		const allowBuilding = document.getElementById("adminBuildToggle").dataset.allowed === "true";
		const noSmoking = document.getElementById("adminNoSmokingToggle").dataset.forbidden === "true";
		const isOutside = document.getElementById("adminOutsideToggle").dataset.outside === "true";

		if (!roomName) {
			showNotification("Benoem de kamer.");
			return;
		}
		// Maak een URL-vriendelijke naam
		const sanitizedName = roomName
			.toLowerCase()
			.replace(/\s+/g, "-")
			.replace(/[^a-z0-9-]/g, "");

		if (!sanitizedName) {
			showNotification("De ingevoerde naam is ongeldig.");
			return;
		}

		// Omdat we geen bestanden kunnen schrijven (browser security), gebruiken we URL parameters.
		// Dit herlaadt de pagina met de nieuwe instellingen (naam en grootte).
		window.location.search = `?room=${sanitizedName}&size=${selectedSize}&alwaysOnline=${alwaysOnline}&allowBuilding=${allowBuilding}&noSmoking=${noSmoking}&isOutside=${isOutside}`;
	});

	document.getElementById("resizeRoomBtn").addEventListener("click", () => {
		const w = parseInt(document.getElementById("roomWidthInput").value) || 10;
		const h = parseInt(document.getElementById("roomHeightInput").value) || 10;
		socket.emit("resizeRoom", { width: w, height: h });
	});

	document.getElementById("saveRoomBtn").addEventListener("click", () => {
		socket.emit("manualSaveRoom", {
			objects: objects,
			wallObjects: wallObjects,
			tileColors: tileColors,
			wallColors: wallColors,
			items: items.map(serializeItem),
			puddles: tilePuddles, // NIEUW: Sla puddles op
			snow: tileSnow, // NIEUW: Sla sneeuw op
		});
		showNotification("Kamer opgeslagen!");
	});

	document.getElementById("setSpawnBtn").addEventListener("click", () => {
		socket.emit("setRoomSpawn", { x: ball.x, y: ball.y });

		// NIEUW: Vergeet mijn oude positie zodat ik de volgende keer op de nieuwe spawn kom
		const urlParams = new URLSearchParams(window.location.search);
		const roomId = urlParams.get("room") || "testroom";
		localStorage.removeItem(`habboCloneLastPos_${roomId}`);

		showNotification("Nieuwe spawn ingesteld!");
	});

	document.getElementById("adminTileNumbersToggle").addEventListener("click", () => {
		showTileNumbers = !showTileNumbers;
		const img = document.getElementById("adminTileNumbersToggle");
		img.src = showTileNumbers ? "icons/numbers_active.png" : "icons/numbers.png";
	});

	document.getElementById("clearRoomBtn").addEventListener("click", () => {
		if (confirm("Weet je zeker dat je alle losse items wilt verwijderen? Geplaatste objecten blijven staan.")) {
			[...items].forEach((item) => {
				socket.emit("removeItem", {
					x: Math.floor(item.x),
					y: Math.floor(item.y),
					type: item.type,
					name: item.name,
					id: item.id,
				});
			});
			showNotification("Alle items verwijderd!");
		}
	});

	// NIEUW: Real-time sync toggle listener
	const adminRealTimeToggle = document.getElementById("adminRealTimeToggle");
	if (adminRealTimeToggle) {
		adminRealTimeToggle.addEventListener("click", () => {
			const current = adminRealTimeToggle.dataset.active === "true";
			if (socket) socket.emit("toggleRealTime", !current);
		});
	}

	// ─────────────────────────────────────────────
	// 📤 UPLOAD CUSTOM ITEM LOGICA
	// ─────────────────────────────────────────────
	const uploadToolBtn = document.getElementById("uploadToolBtn");
	const uploadModal = document.getElementById("uploadModal");
	const customFileUpload = document.getElementById("customFileUpload");
	const closeUploadModal = document.getElementById("closeUploadModal");
	const closeUploadModalCross = document.getElementById("closeUploadModalCross");
	const uploadConfigStep = document.getElementById("uploadConfigStep");
	let selectedTemplate = null;
	let currentUploadFile = null;

	// Variabelen voor de visuele editor
	const collisionCanvas = document.getElementById("collisionCanvas");
	const collisionCtx = collisionCanvas.getContext("2d");
	let previewImageObj = null;
	let isResizingCollision = false;
	let colBox = { x: 0, y: 0, w: 1, h: 1 }; // w,h in tegels, x,y in pixels
	let dragMode = null; // 'move', 'se', etc.
	let dragStartMouse = { x: 0, y: 0 };
	let dragStartBox = { x: 0, y: 0, w: 1, h: 1 };

	if (uploadToolBtn) {
		uploadToolBtn.addEventListener("mousedown", () => {
			uploadToolBtn.querySelector("img").src = "icons/add_active.png";
		});
		const resetUploadBtn = () => {
			uploadToolBtn.querySelector("img").src = "icons/add.png";
		};
		uploadToolBtn.addEventListener("mouseup", resetUploadBtn);
		uploadToolBtn.addEventListener("mouseleave", resetUploadBtn);

		uploadToolBtn.addEventListener("click", () => {
			customFileUpload.click();
		});
	}

	// NIEUW: Functie om modal te openen in bewerk-modus
	function openEditModal(item) {
		editingObject = item;
		uploadModal.style.display = "flex";
		uploadConfigStep.style.display = "flex";

		// Vul velden
		document.getElementById("customObjectName").value = item.name;
		document.getElementById("customObjectPrice").value = item.price || "";
		document.getElementById("customObjectKeywords").value = item.keywords ? item.keywords.join(", ") : "";
		document.getElementById("customObjectAdminOnly").checked = item.adminOnly || false;

		// Vul configuratie
		document.getElementById("confWidth").value = item.width || 1;
		document.getElementById("confDepth").value = item.depth || 1;
		document.getElementById("confHeight").value = item.height || 1;
		document.getElementById("confWalkable").checked = item.isFloor || false;
		document.getElementById("confMoveable").checked = item.moveable || false;

		// Zet collision box
		colBox = {
			x: item.xOffset !== undefined ? item.xOffset : 0,
			y: item.yOffset !== undefined ? item.yOffset : 0,
			w: item.width || 1,
			h: item.depth || 1,
		};

		// Laad plaatje voor preview
		previewImageObj = new Image();
		previewImageObj.src = item.image;
		previewImageObj.onload = () => {
			drawCollisionPreview();
		};

		// UI updates
		document.getElementById("doUploadBtn").textContent = "Bijwerken";
		document.querySelector("#uploadModal h4").textContent = "Object Bewerken";

		// Reset file input (we gebruiken bestaand plaatje tenzij gebruiker kiest)
		customFileUpload.value = "";
		currentUploadFile = null;
	}

	function closeUploadModalFunc() {
		uploadModal.style.display = "none";
		customFileUpload.value = "";
		document.getElementById("customObjectName").value = "";
		document.getElementById("customObjectPrice").value = "";
		document.getElementById("customObjectKeywords").value = "";
		document.getElementById("customObjectAdminOnly").checked = false;
		editingObject = null;
		document.getElementById("doUploadBtn").textContent = "Bevestigen & Uploaden";
		document.querySelector("#uploadModal h4").textContent = "Object Uploaden";
		uploadConfigStep.style.display = "none";
	}

	if (closeUploadModal) {
		closeUploadModal.addEventListener("click", () => {
			closeUploadModalFunc();
		});
	}

	if (closeUploadModalCross) {
		closeUploadModalCross.addEventListener("click", () => {
			closeUploadModalFunc();
		});
	}

	if (customFileUpload) {
		customFileUpload.addEventListener("change", (e) => {
			const file = e.target.files[0];
			if (!file) return;
			currentUploadFile = file;

			uploadModal.style.display = "flex";

			// Toon configuratie stap
			uploadConfigStep.style.display = "flex";

			// Vul template select
			const templateSelect = document.getElementById("templateSelect");
			templateSelect.innerHTML = "";

			// NIEUW: Georganiseerde structuur voor templates
			const templateGroups = {
				Objects: [
					{ name: "Blok", label: "Blok" },
					{ name: "Hoge Blok", label: "Hoog blok" },
					{ name: "Tafel", label: "Breed blok" },
				],
				Moveable: [
					{ name: "Verplaatsbaar Blok", label: "Blok" },
					{ name: "Verplaatsbare Tafel", label: "Breed blok" },
				],
				Container: [
					{ name: "Container", label: "Kist" },
					{ name: "Grote Container", label: "Locker" },
					{ name: "Brede Container", label: "Brede kist" },
				],
				Trash: [
					{ name: "Prullenbak", label: "Prullenbak" },
					{ name: "Brede Prullenbak", label: "Afval container" },
				],
				Shop: [
					{ name: "Winkel", label: "Automaat" },
					{ name: "Brede Winkel", label: "Balie" },
				],
				Water: [
					{ name: "Kraan", label: "Kraan" },
					{ name: "Hoge Kraan", label: "Dispenser" },
				],
				Games: [{ name: "Pong", label: "Pong" }],
				Floor: [{ name: "Vloer", label: "Vloer" }],
				Wall: [
					{ name: "Muurdecoratie", label: "Muur" },
					{ name: "Brede Muurdecoratie", label: "Brede muur" },
				],
				"Wall decoration (vrije verplaatsing)": [
					{ name: "Vrije Muurdecoratie", label: "Decoratie" },
					{ name: "Brede Vrije Muurdecoratie", label: "Decoratie breed" },
				],
			};

			let firstOption = null;

			for (const [groupName, templates] of Object.entries(templateGroups)) {
				const optgroup = document.createElement("optgroup");
				optgroup.label = groupName;
				let hasOptions = false;

				templates.forEach((tmplDef) => {
					// Zoek de template in de lijst (negeer custom objects die al geupload zijn)
					const templateObj = buildableObjects.find((b) => b.name === tmplDef.name && b.isTemplate && !b.isCustom);
					if (templateObj) {
						const option = document.createElement("option");
						option.value = templateObj.name;
						option.text = tmplDef.label;
						option.dataset.json = JSON.stringify(templateObj);
						optgroup.appendChild(option);
						hasOptions = true;
						if (!firstOption) firstOption = templateObj;
					}
				});

				if (hasOptions) templateSelect.appendChild(optgroup);
			}

			// Selecteer eerste als default
			if (firstOption) {
				selectedTemplate = firstOption;
				updateUploadUI();
			}

			// Toon preview
			previewImageObj = new Image();
			const reader = new FileReader();
			reader.onload = (evt) => {
				previewImageObj.src = evt.target.result;
				previewImageObj.onload = () => {
					// Reset box naar standaard (isometrisch: ankerpunt in het midden onderaan)
					colBox.w = parseInt(document.getElementById("confWidth").value) || 1;
					colBox.h = parseInt(document.getElementById("confDepth").value) || 1;

					// Bepaal y-offset op basis van template type
					let yOffset = 32;
					if (selectedTemplate && selectedTemplate.placement === "wall") {
						yOffset = colBox.w > 1 ? 32 : 16;
						colBox.x = Math.floor(previewImageObj.width / 2);
					} else {
						yOffset = (colBox.w + colBox.h) * 16; // Dynamisch voor vloer objecten (w+d)*16
						// NIEUW: X-offset correctie voor niet-vierkante objecten (zoals Pong 2x1)
						colBox.x = Math.floor(previewImageObj.width / 2) - (colBox.w - colBox.h) * 16;
					}
					colBox.y = Math.max(0, previewImageObj.height - yOffset);
					drawCollisionPreview();
				};
			};
			reader.readAsDataURL(file);
		});
	}

	// Update template bij selectie
	document.getElementById("templateSelect").addEventListener("change", (e) => {
		const option = e.target.options[e.target.selectedIndex];
		if (option && option.dataset.json) {
			selectedTemplate = JSON.parse(option.dataset.json);
			updateUploadUI();
		}
	});

	function updateUploadUI() {
		if (!selectedTemplate) return;
		const isWall = selectedTemplate.placement === "wall";

		const configStep = document.getElementById("uploadConfigStep");
		const inputGrid = configStep.querySelector("div:first-child > div:nth-child(2)");
		const checkboxRow = configStep.querySelector("div:nth-child(2)");

		if (isWall) {
			if (inputGrid) inputGrid.style.display = "none";
			if (checkboxRow) checkboxRow.style.display = "none";

			// Forceer waarden van template
			colBox.w = selectedTemplate.width || 1;
			colBox.h = selectedTemplate.depth || 1;

			// Reset offsets naar standaard voor dit type muurdecoratie als er een plaatje is
			if (previewImageObj) {
				const stdOffset = colBox.w > 1 ? 32 : 16;
				colBox.y = Math.max(0, previewImageObj.height - stdOffset);
				colBox.x = Math.floor(previewImageObj.width / 2);
			}

			document.getElementById("confWidth").value = colBox.w;
			document.getElementById("confDepth").value = colBox.h;
			document.getElementById("confHeight").value = selectedTemplate.height || 1;
		} else {
			if (inputGrid) inputGrid.style.display = "flex";
			if (checkboxRow) checkboxRow.style.display = "flex";

			document.getElementById("confWalkable").checked = selectedTemplate.isFloor || false;
			document.getElementById("confMoveable").checked = selectedTemplate.moveable || false;

			colBox.w = selectedTemplate.width || 1;
			colBox.h = selectedTemplate.depth || 1;
			document.getElementById("confWidth").value = colBox.w;
			document.getElementById("confDepth").value = colBox.h;
			document.getElementById("confHeight").value = selectedTemplate.height || 1;

			// NIEUW: Reset offsets voor vloer objecten zodat ze matchen met template
			if (previewImageObj) {
				const yOffset = (colBox.w + colBox.h) * 16;
				colBox.y = Math.max(0, previewImageObj.height - yOffset);
				colBox.x = Math.floor(previewImageObj.width / 2) - (colBox.w - colBox.h) * 16;
			}
		}
		if (previewImageObj) drawCollisionPreview();
	}

	// Functie om de preview en het grid te tekenen
	function drawCollisionPreview() {
		if (!previewImageObj) return;

		// Haal huidige waarden op
		const w = colBox.w;
		const d = colBox.h;

		// Pas canvas grootte aan op plaatje (met minimum voor grid)
		// We voegen flink wat padding toe zodat je buiten het plaatje kunt slepen
		const canvasW = Math.max(previewImageObj.width + 48, 180);
		const canvasH = Math.max(previewImageObj.height + 48, 180);

		// Voorkom dat canvas reset als grootte niet verandert (voorkomt flikkering)
		if (collisionCanvas.width !== canvasW || collisionCanvas.height !== canvasH) {
			collisionCanvas.width = canvasW;
			collisionCanvas.height = canvasH;
		}

		collisionCtx.clearRect(0, 0, collisionCanvas.width, collisionCanvas.height);

		// 1. Teken het plaatje (gecentreerd in canvas)
		const imgX = (canvasW - previewImageObj.width) / 2;
		const imgY = (canvasH - previewImageObj.height) / 2;

		// Teken een kader om het plaatje ter referentie
		collisionCtx.strokeStyle = "rgba(255,255,255,0.1)";
		collisionCtx.strokeRect(imgX, imgY, previewImageObj.width, previewImageObj.height);

		collisionCtx.drawImage(previewImageObj, imgX, imgY);

		// Sla de offset op voor berekeningen
		collisionCanvas.imgOffset = { x: imgX, y: imgY };

		// 2. Teken het ISOMETRISCHE collision grid
		const originX = imgX + colBox.x;
		const originY = imgY + colBox.y;

		// Helper om schermcoördinaten te krijgen van een tegel (relatief aan origin)
		const getIsoPt = (tx, ty) => {
			const sx = (tx - ty) * 32; // 64 breed / 2
			const sy = (tx + ty) * 16; // 32 hoog / 2
			return { x: originX + sx, y: originY + sy };
		};

		// Punten van de diamant (buitenkant)
		const pTop = getIsoPt(0, 0);
		const pRight = getIsoPt(w, 0);
		const pBottom = getIsoPt(w, d);
		const pLeft = getIsoPt(0, d);

		// Teken het blauwe vlak
		collisionCtx.beginPath();
		collisionCtx.moveTo(pTop.x, pTop.y);
		collisionCtx.lineTo(pRight.x, pRight.y);
		collisionCtx.lineTo(pBottom.x, pBottom.y);
		collisionCtx.lineTo(pLeft.x, pLeft.y);
		collisionCtx.closePath();

		collisionCtx.fillStyle = "rgba(0, 100, 255, 0.4)";
		collisionCtx.fill();
		collisionCtx.strokeStyle = "rgba(0, 100, 255, 0.8)";
		collisionCtx.lineWidth = 2;
		collisionCtx.stroke();

		// 3. Teken grid lijnen binnen het vlak
		collisionCtx.strokeStyle = "rgba(255, 255, 255, 0.5)";
		collisionCtx.lineWidth = 1;
		collisionCtx.beginPath();
		for (let i = 0; i <= w; i++) {
			const p1 = getIsoPt(i, 0);
			const p2 = getIsoPt(i, d);
			collisionCtx.moveTo(p1.x, p1.y);
			collisionCtx.lineTo(p2.x, p2.y);
		}
		for (let j = 0; j <= d; j++) {
			const p1 = getIsoPt(0, j);
			const p2 = getIsoPt(w, j);
			collisionCtx.moveTo(p1.x, p1.y);
			collisionCtx.lineTo(p2.x, p2.y);
		}
		collisionCtx.stroke();

		// 4. Teken de 4 hoekpunten (hendels)
		const drawHandle = (pt, color) => {
			collisionCtx.beginPath();
			collisionCtx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
			collisionCtx.fillStyle = color;
			collisionCtx.fill();
			collisionCtx.strokeStyle = "black";
			collisionCtx.lineWidth = 1;
			collisionCtx.stroke();
		};

		drawHandle(pTop, "#ffffff"); // Wit: Verplaatsen (Origin)
		drawHandle(pRight, "#ffeb3b"); // Geel: Breedte (X)
		drawHandle(pLeft, "#ffeb3b"); // Geel: Diepte (Y)
		drawHandle(pBottom, "#ffeb3b"); // Geel: Beide
	}

	// Muis interactie voor het canvas
	collisionCanvas.addEventListener("mousedown", (e) => {
		if (!previewImageObj) return;
		const rect = collisionCanvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;

		const imgX = collisionCanvas.imgOffset ? collisionCanvas.imgOffset.x : 0;
		const imgY = collisionCanvas.imgOffset ? collisionCanvas.imgOffset.y : 0;
		const originX = imgX + colBox.x;
		const originY = imgY + colBox.y;

		// Helper voor iso punten
		const getIsoPt = (tx, ty) => {
			const sx = (tx - ty) * 32;
			const sy = (tx + ty) * 16;
			return { x: originX + sx, y: originY + sy };
		};

		const pTop = getIsoPt(0, 0);
		const pRight = getIsoPt(colBox.w, 0);
		const pLeft = getIsoPt(0, colBox.h);
		const pBottom = getIsoPt(colBox.w, colBox.h);

		const dist = (p) => Math.sqrt((mx - p.x) ** 2 + (my - p.y) ** 2);
		const hitRadius = 12; // Grotere radius voor makkelijker klikken

		// Check handles
		if (dist(pTop) < hitRadius) dragMode = "move";
		else if (dist(pRight) < hitRadius) dragMode = "resizeW";
		else if (dist(pLeft) < hitRadius) dragMode = "resizeD";
		else if (dist(pBottom) < hitRadius) dragMode = "resizeWD";
		else {
			// Check of we IN de diamant klikken voor verplaatsen
			// Inverse iso transformatie om tegel-coördinaten te vinden
			const dx = mx - originX;
			const dy = my - originY;
			// tx = (dx/32 + dy/16) / 2
			// ty = (dy/16 - dx/32) / 2
			const tileX = (dx / 32 + dy / 16) / 2;
			const tileY = (dy / 16 - dx / 32) / 2;

			if (tileX >= 0 && tileX <= colBox.w && tileY >= 0 && tileY <= colBox.h) {
				dragMode = "move";
			} else {
				return;
			}
		}

		isResizingCollision = true;
		dragStartMouse = { x: mx, y: my };
		dragStartBox = { ...colBox };
	});

	window.addEventListener("mousemove", (e) => {
		if (isResizingCollision && uploadModal.style.display === "flex") {
			const rect = collisionCanvas.getBoundingClientRect();
			const mx = e.clientX - rect.left;
			const my = e.clientY - rect.top;

			const dx = mx - dragStartMouse.x;
			const dy = my - dragStartMouse.y;

			if (dragMode === "move") {
				colBox.x = dragStartBox.x + dx;
				colBox.y = dragStartBox.y + dy;
			} else {
				// Resize logica (isometrisch)
				// We moeten de muisbeweging vertalen naar 'tegel' delta's

				// Origin positie (die verandert niet tijdens resize)
				const imgX = collisionCanvas.imgOffset ? collisionCanvas.imgOffset.x : 0;
				const imgY = collisionCanvas.imgOffset ? collisionCanvas.imgOffset.y : 0;
				const originX = imgX + colBox.x;
				const originY = imgY + colBox.y;

				// Huidige muispositie relatief aan origin
				const relX = mx - originX;
				const relY = my - originY;

				// Converteer naar tegel-eenheden
				const rawTileX = (relX / 32 + relY / 16) / 2;
				const rawTileY = (relY / 16 - relX / 32) / 2;

				let newW = colBox.w;
				let newH = colBox.h;

				if (dragMode === "resizeW" || dragMode === "resizeWD") {
					newW = Math.max(1, Math.round(rawTileX));
				}
				if (dragMode === "resizeD" || dragMode === "resizeWD") {
					newH = Math.max(1, Math.round(rawTileY));
				}

				// Maximaal (bijv 10x10 om gekkigheid te voorkomen)
				if (newW > 10) newW = 10;
				if (newH > 10) newH = 10;

				colBox.w = newW;
				colBox.h = newH;

				// Update inputs
				document.getElementById("confWidth").value = newW;
				document.getElementById("confDepth").value = newH;
			}

			drawCollisionPreview();
		} else {
			// Cursor updates
			const rect = collisionCanvas.getBoundingClientRect();
			const mx = e.clientX - rect.left;
			const my = e.clientY - rect.top;
			const imgX = collisionCanvas.imgOffset ? collisionCanvas.imgOffset.x : 0;
			const imgY = collisionCanvas.imgOffset ? collisionCanvas.imgOffset.y : 0;
			const originX = imgX + colBox.x;
			const originY = imgY + colBox.y;

			const getIsoPt = (tx, ty) => {
				const sx = (tx - ty) * 32;
				const sy = (tx + ty) * 16;
				return { x: originX + sx, y: originY + sy };
			};

			const pTop = getIsoPt(0, 0);
			const pRight = getIsoPt(colBox.w, 0);
			const pLeft = getIsoPt(0, colBox.h);
			const pBottom = getIsoPt(colBox.w, colBox.h);
			const dist = (p) => Math.sqrt((mx - p.x) ** 2 + (my - p.y) ** 2);
			const hitRadius = 12;

			if (dist(pTop) < hitRadius) collisionCanvas.style.cursor = "move";
			else if (dist(pRight) < hitRadius || dist(pLeft) < hitRadius || dist(pBottom) < hitRadius) collisionCanvas.style.cursor = "pointer";
			else {
				// Check inside
				const dx = mx - originX;
				const dy = my - originY;
				const tileX = (dx / 32 + dy / 16) / 2;
				const tileY = (dy / 16 - dx / 32) / 2;
				if (tileX >= 0 && tileX <= colBox.w && tileY >= 0 && tileY <= colBox.h) {
					collisionCanvas.style.cursor = "move";
				} else {
					collisionCanvas.style.cursor = "default";
				}
			}
		}
	});

	window.addEventListener("mouseup", () => {
		isResizingCollision = false;
		dragMode = null;
	});

	// Update preview als je handmatig getallen typt
	document.getElementById("confWidth").addEventListener("input", (e) => {
		colBox.w = parseInt(e.target.value) || 1;
		// Auto-update offsets als we niet met muren bezig zijn
		if (previewImageObj && (!selectedTemplate || selectedTemplate.placement !== "wall")) {
			const yOffset = (colBox.w + colBox.h) * 16;
			colBox.y = Math.max(0, previewImageObj.height - yOffset);
			colBox.x = Math.floor(previewImageObj.width / 2) - (colBox.w - colBox.h) * 16;
		}
		drawCollisionPreview();
	});
	document.getElementById("confDepth").addEventListener("input", (e) => {
		colBox.h = parseInt(e.target.value) || 1;
		if (previewImageObj && (!selectedTemplate || selectedTemplate.placement !== "wall")) {
			const yOffset = (colBox.w + colBox.h) * 16;
			colBox.y = Math.max(0, previewImageObj.height - yOffset);
			colBox.x = Math.floor(previewImageObj.width / 2) - (colBox.w - colBox.h) * 16;
		}
		drawCollisionPreview();
	});

	// NIEUW: Automatische template selectie op basis van naam
	document.getElementById("customObjectName").addEventListener("input", (e) => {
		const val = e.target.value.toLowerCase();
		const select = document.getElementById("templateSelect");
		if (!select || select.options.length === 0) return;

		// Check huidige type om te voorkomen dat we een specifieke keuze (bv. Brede Muur) overschrijven
		const getCurrentType = () => {
			const opt = select.options[select.selectedIndex];
			if (!opt || !opt.dataset.json) return null;
			const data = JSON.parse(opt.dataset.json);
			if (data.placement === "wall") return "wall";
			if (data.isFloor) return "floor";
			return "object";
		};

		const currentType = getCurrentType();

		// Als 'muur' in de naam zit en we staan nog niet op een muur-template -> Selecteer Muur
		if (val.includes("muur") && currentType !== "wall") {
			const opts = Array.from(select.options);
			const wallOpt = opts.find((o) => o.value === "Muurdecoratie");
			if (wallOpt) {
				select.value = "Muurdecoratie";
				select.dispatchEvent(new Event("change"));
			}
		}
		// Optioneel: zelfde voor vloer
		else if ((val.includes("vloer") || val.includes("tegel")) && currentType !== "floor") {
			const opts = Array.from(select.options);
			const floorOpt = opts.find((o) => o.value === "Vloer");
			if (floorOpt) {
				select.value = "Vloer";
				select.dispatchEvent(new Event("change"));
			}
		}
	});

	// NIEUW: Knoppen voor configuratie stap
	document.getElementById("cancelConfigBtn").addEventListener("click", () => {
		closeUploadModalFunc();
	});

	document.getElementById("doUploadBtn").addEventListener("click", () => {
		// Validatie: bij bewerken is file optioneel, bij nieuw verplicht
		if (!editingObject && (!currentUploadFile || !selectedTemplate)) return;
		if (editingObject && !currentUploadFile && !previewImageObj) return;

		const nameInput = document.getElementById("customObjectName");
		const enteredName = nameInput.value.trim();
		const priceInput = document.getElementById("customObjectPrice");
		const keywordsInput = document.getElementById("customObjectKeywords");
		const keywords = keywordsInput.value
			.split(",")
			.map((k) => k.trim())
			.filter((k) => k);
		const adminOnlyInput = document.getElementById("customObjectAdminOnly");

		// Haal configuratie waarden op
		const width = colBox.w;
		const depth = colBox.h;
		const height = parseInt(document.getElementById("confHeight").value) || 1;
		const isFloor = document.getElementById("confWalkable").checked;
		const moveable = document.getElementById("confMoveable").checked;

		if (socket) {
			if (editingObject) {
				// Update bestaand object
				socket.emit("updateCustomObject", {
					originalName: editingObject.name,
					name: enteredName,
					price: priceInput.value,
					adminOnly: adminOnlyInput.checked,
					width,
					depth,
					height,
					isFloor,
					moveable,
					xOffset: colBox.x,
					yOffset: colBox.y,
					imageData: currentUploadFile, // Optioneel: nieuw plaatje
					keywords: keywords,
				});
				showNotification("Object wordt bijgewerkt...");
			} else {
				// Nieuw object uploaden
				socket.emit("uploadCustomObject", {
					imageData: currentUploadFile,
					template: selectedTemplate,
					name: enteredName,
					price: priceInput.value,
					adminOnly: adminOnlyInput.checked,
					width,
					depth,
					height,
					isFloor,
					moveable,
					xOffset: colBox.x,
					yOffset: colBox.y,
					keywords: keywords,
				});
				showNotification("Object wordt geüpload...");
			}
		}

		// Sluit en reset
		closeUploadModalFunc();
	});

	// ─────────────────────────────────────────────
	// 🏓 PONG MINIGAME LOGICA
	// ─────────────────────────────────────────────
	const pongCanvas = document.getElementById("pongCanvas");
	const pongCtx = pongCanvas.getContext("2d");
	const playerScoreEl = document.getElementById("playerScore");
	const aiScoreEl = document.getElementById("aiScore");
	let pongGameStarted = false; // NIEUW: Houdt bij of we voorbij het startscherm zijn
	let pongRunning = false;
	let isScoring = false; // NIEUW: Pauze na score
	let pongAnimationId;

	const pongBall = { x: 300, y: 132, vx: 3, vy: 3, size: 6 }; // Startpositie gecentreerd op 600x264
	const paddleHeight = 60;
	const paddleWidth = 10;
	const playerPaddle = { x: 10, y: 120, score: 0 };
	const aiPaddle = { x: 580, y: 120, score: 0 }; // Aangepast naar rechts (600 - 20)

	let isPongAI = true; // Default AI
	let currentPongOpponentId = null; // ID van tegenstander voor PvP
	let pongCountdown = 0; // Afteller
	let isPongPaused = false; // Pauze status
	let isPongHost = false; // Ben ik de baas over de bal?
	let pongPauseCountdown = 0; // Pauze afteller
	let pongPauseInterval = null; // Interval voor pauze
	let pongPauseInitiator = ""; // Wie heeft gepauzeerd?

	function startPongGame(aiMode = true, opponentName = "Tegenstander", opponentId = null, isHost = false) {
		const pongGame = document.getElementById("pongGame");
		pongGame.style.display = "flex";
		resetPongBall();
		playerPaddle.score = 0;
		aiPaddle.score = 0;
		playerScoreEl.textContent = "0";
		aiScoreEl.textContent = "0";

		// Namen instellen
		document.getElementById("playerNameLabel").textContent = "Jij";
		document.getElementById("opponentNameLabel").textContent = opponentName;

		currentPongOpponentId = opponentId;
		isPongAI = aiMode;
		isPongHost = isHost;

		// Reset pauze variabelen
		isPongPaused = false;
		if (pongPauseInterval) clearInterval(pongPauseInterval);

		isScoring = false;
		document.getElementById("pongBackdrop").style.display = "block";
		updatePongCursorState(true); // Verberg cursor wel alvast

		if (isPongAI) {
			pongGameStarted = false; // AI: Wacht op spatie
			pongRunning = false;
		} else {
			// PvP: Start direct met countdown
			pongGameStarted = true;
			pongRunning = false;
			pongCountdown = 3;

			// Start aftellen
			const countInterval = setInterval(() => {
				pongCountdown--;
				if (pongCountdown <= 0) {
					clearInterval(countInterval);
					pongRunning = true;
				}
			}, 1000);
		}

		pongLoop();
	}

	function stopPongGame() {
		const pongGame = document.getElementById("pongGame");
		pongGame.style.display = "none";
		document.getElementById("pongBackdrop").style.display = "none";
		pongRunning = false;
		pongGameStarted = false;
		isPongPaused = false;
		if (pongPauseInterval) clearInterval(pongPauseInterval);
		updatePongCursorState(false);
		cancelAnimationFrame(pongAnimationId);
	}

	document.getElementById("closePongBtn").addEventListener("click", () => {
		// Als we PvP spelen en we sluiten, stuur quit bericht
		if (!isPongAI && socket && currentPongOpponentId) {
			socket.emit("quitPong", { opponentId: currentPongOpponentId });
		}
		stopPongGame();
	});

	let lastPaddleSend = 0; // Voor throttling

	window.addEventListener("mousemove", (e) => {
		// Bestuur batje alleen als spel draait EN we niet het venster aan het slepen zijn
		if (pongRunning && !isDraggingPong && !isPongPaused) {
			const rect = pongCanvas.getBoundingClientRect();
			const mouseY = e.clientY - rect.top;
			playerPaddle.y = mouseY - paddleHeight / 2;

			// Clamp paddle binnen canvas
			if (playerPaddle.y < 0) playerPaddle.y = 0;
			if (playerPaddle.y > pongCanvas.height - paddleHeight) playerPaddle.y = pongCanvas.height - paddleHeight;

			// Stuur positie naar server voor PvP
			if (socket && !isPongAI) {
				// THROTTLING: Stuur max 1x per 50ms (20fps) om lag te voorkomen
				const now = Date.now();
				if (now - lastPaddleSend > 50) {
					socket.emit("pongPaddleMove", {
						y: playerPaddle.y,
						opponentId: currentPongOpponentId,
					});
					lastPaddleSend = now;
				}
			}
		}
	});

	function resetPongBall() {
		pongBall.x = pongCanvas.width / 2;
		pongBall.y = pongCanvas.height / 2;
		pongBall.vx = (Math.random() > 0.5 ? 1 : -1) * (4 + Math.random() * 2); // Snelheid iets verlaagd
		pongBall.vy = (Math.random() > 0.5 ? 1 : -1) * (2 + Math.random() * 2); // Snelheid iets verlaagd
	}

	function scorePause() {
		isScoring = true;
		resetPongBall();
		setTimeout(() => {
			isScoring = false;
		}, 1000);
	}

	function updatePong() {
		// Als we PvP spelen en GEEN host zijn, berekenen we niks zelf.
		// We wachten puur op data van de server.
		if (!isPongAI && !isPongHost) return;

		pongBall.x += pongBall.vx;
		pongBall.y += pongBall.vy;

		// Botsing boven/onder
		if (pongBall.y < 0 || pongBall.y > pongCanvas.height) pongBall.vy = -pongBall.vy;

		if (isPongAI) {
			// AI Beweging (simpel volgen met vertraging)
			const aiCenter = aiPaddle.y + paddleHeight / 2;
			if (aiCenter < pongBall.y - 10) aiPaddle.y += 2.5;
			else if (aiCenter > pongBall.y + 10) aiPaddle.y -= 2.5;

			// Clamp AI
			if (aiPaddle.y < 0) aiPaddle.y = 0;
			if (aiPaddle.y > pongCanvas.height - paddleHeight) aiPaddle.y = pongCanvas.height - paddleHeight;
		}

		// Botsing Speler Paddle
		if (pongBall.x < playerPaddle.x + paddleWidth && pongBall.y > playerPaddle.y && pongBall.y < playerPaddle.y + paddleHeight) {
			pongBall.vx = -pongBall.vx * 1.05; // Versnellen
			pongBall.x = playerPaddle.x + paddleWidth;
		}
		// Botsing AI Paddle
		if (pongBall.x > aiPaddle.x - pongBall.size && pongBall.y > aiPaddle.y && pongBall.y < aiPaddle.y + paddleHeight) {
			pongBall.vx = -pongBall.vx * 1.05;
			pongBall.x = aiPaddle.x - pongBall.size;
		}

		// Score
		if (pongBall.x < 0) {
			aiPaddle.score++;
			aiScoreEl.textContent = aiPaddle.score;
			scorePause();
			if (!isPongAI) sendScoreUpdate();
		} else if (pongBall.x > pongCanvas.width) {
			playerPaddle.score++;
			playerScoreEl.textContent = playerPaddle.score;
			scorePause();
			if (!isPongAI) sendScoreUpdate();
		}

		// Als Host: stuur bal positie naar tegenstander
		if (!isPongAI && isPongHost && socket) {
			socket.emit("pongBallUpdate", {
				x: pongBall.x,
				y: pongBall.y,
				vx: pongBall.vx,
				vy: pongBall.vy,
				opponentId: currentPongOpponentId,
			});
		}
	}

	function sendScoreUpdate() {
		if (socket && currentPongOpponentId) {
			socket.emit("pongScoreUpdate", {
				playerScore: playerPaddle.score,
				aiScore: aiPaddle.score,
				opponentId: currentPongOpponentId,
			});
		}
	}

	function drawPong() {
		pongCtx.clearRect(0, 0, pongCanvas.width, pongCanvas.height); // Leegmaken voor transparantie

		pongCtx.fillStyle = "white";
		pongCtx.fillRect(playerPaddle.x, playerPaddle.y, paddleWidth, paddleHeight);
		pongCtx.fillRect(aiPaddle.x, aiPaddle.y, paddleWidth, paddleHeight);

		pongCtx.beginPath();
		pongCtx.arc(pongBall.x, pongBall.y, pongBall.size, 0, Math.PI * 2);
		pongCtx.fill();

		// Teken countdown als die bezig is
		if (pongCountdown > 0) {
			pongCtx.fillStyle = "white";
			pongCtx.font = "60px Arial";
			pongCtx.textAlign = "center";
			pongCtx.fillText(pongCountdown, pongCanvas.width / 2, pongCanvas.height / 2);
		}
	}

	// Luister naar tegenstander beweging
	if (socket) {
		socket.on("opponentPaddleMove", (data) => {
			aiPaddle.y = data.y; // Update de rechter paddle met data van de ander
		});
	}

	function updatePongCursorState(isRunning) {
		const val = isRunning ? "none" : "default";
		document.body.style.cursor = val;
		document.getElementById("pongGame").style.cursor = val;
		// Header cursor: 'none' als we spelen, 'move' als we gepauzeerd zijn
		document.getElementById("pongHeader").style.cursor = isRunning ? "none" : "move";
		document.getElementById("pongCanvas").style.cursor = val;
	}

	function pongLoop() {
		if (document.getElementById("pongGame").style.display === "none") return;

		if (!pongGameStarted) {
			// Startscherm tekenen
			drawPong();
			pongCtx.fillStyle = "rgba(0,0,0,0.5)";
			pongCtx.fillRect(0, 0, pongCanvas.width, pongCanvas.height);
			pongCtx.fillStyle = "white";
			pongCtx.font = "30px Arial";
			pongCtx.textAlign = "center";
			pongCtx.fillText("Druk op SPATIE om te starten", pongCanvas.width / 2, pongCanvas.height / 2);
		} else if (pongCountdown > 0) {
			// Tijdens countdown tekenen we alleen de game state (die tekent de cijfers)
			drawPong();
		} else if (isPongPaused) {
			// Pauze scherm
			drawPong();
			pongCtx.fillStyle = "rgba(0,0,0,0.5)";
			pongCtx.fillRect(0, 0, pongCanvas.width, pongCanvas.height);
			pongCtx.fillStyle = "white";
			pongCtx.font = "30px Arial";
			pongCtx.textAlign = "center";
			pongCtx.fillText(`Gepauzeerd door ${pongPauseInitiator}: ${pongPauseCountdown}`, pongCanvas.width / 2, pongCanvas.height / 2);
			pongCtx.font = "16px Arial";
			pongCtx.fillText("Klik op kruisje om te stoppen", pongCanvas.width / 2, pongCanvas.height / 2 + 30);
		} else if (pongRunning) {
			if (!isScoring) updatePong(); // Alleen updaten als we niet in score-pauze zitten
			drawPong();
		} else {
			// Als gepauzeerd: teken de game (statisch) en de overlay
			drawPong();
			pongCtx.fillStyle = "rgba(0,0,0,0.5)";
			pongCtx.fillRect(0, 0, pongCanvas.width, pongCanvas.height);
			pongCtx.fillStyle = "white";
			pongCtx.font = "30px Arial";
			pongCtx.textAlign = "center";
			pongCtx.fillText("Gepauzeerd", pongCanvas.width / 2, pongCanvas.height / 2);
			pongCtx.font = "16px Arial";
			pongCtx.fillText("Druk op ESC om verder te gaan", pongCanvas.width / 2, pongCanvas.height / 2 + 30);
		}

		pongAnimationId = requestAnimationFrame(pongLoop);
	}

	// Chat
	const chatInput = document.getElementById("chatInput");
	let chatMessages = [];
	let allRoomMessages = [];

	const chatLog = document.getElementById("chatLog");
	const openChatLogBtn = document.getElementById("openChatLog");

	openChatLogBtn.addEventListener("click", () => {
		const img = openChatLogBtn.querySelector("img");
		if (chatLog.style.display === "block") {
			chatLog.style.display = "none";
			img.src = "icons/chat.png";
		} else {
			chatLog.style.display = "block";
			img.src = "icons/chat_active.png";
			const content = document.getElementById("chatLogContent");
			content.scrollTop = content.scrollHeight;
		}
	});

	function sendChatMessage(text, user = "Jij") {
		if (socket) {
			socket.emit("chatMessage", text);
		} else {
			receiveChatMessage({ user: "Jij", text: text, id: "local", color: myColor });
		}
	}

	function receiveChatMessage(data) {
		const now = Date.now();
		const msg = {
			text: data.text,
			user: data.user,
			id: data.id,
			userId: data.userId,
			color: data.color, // NIEUW: Kleur opslaan
			time: data.time || now, // Gebruik server tijd indien beschikbaar
			duration: 5000,
		};
		chatMessages.push(msg);
		allRoomMessages.push(msg);
		updateChatLog();
	}

	if (socket) {
		socket.on("chatMessage", (data) => {
			receiveChatMessage(data);
		});
	}

	function updateChatLog() {
		const content = document.getElementById("chatLogContent");
		content.innerHTML = "";
		let lastSpeakerId = null; // Houdt de ID van de vorige spreker bij
		let lastDateStr = null; // NIEUW: Houdt de datum bij voor separators

		allRoomMessages.forEach((m) => {
			// NIEUW: Datum separator logica (WhatsApp stijl)
			const msgDate = new Date(m.time);
			const dateStr = msgDate.toLocaleDateString("nl-NL");

			if (dateStr !== lastDateStr) {
				const dateDiv = document.createElement("div");
				dateDiv.style.textAlign = "center";
				dateDiv.style.margin = "15px 0 10px 0";
				dateDiv.style.fontSize = "11px";
				dateDiv.style.color = "#ccc";

				const now = new Date();
				const todayStr = now.toLocaleDateString("nl-NL");
				const yesterday = new Date(now);
				yesterday.setDate(yesterday.getDate() - 1);
				const yesterdayStr = yesterday.toLocaleDateString("nl-NL");

				let label = dateStr;
				if (dateStr === todayStr) label = "Vandaag";
				else if (dateStr === yesterdayStr) label = "Gisteren";

				const span = document.createElement("span");
				span.style.backgroundColor = "rgba(40, 40, 40, 0.6)";
				span.style.padding = "4px 10px";
				span.style.borderRadius = "10px";
				span.textContent = label;

				dateDiv.appendChild(span);
				content.appendChild(dateDiv);

				lastDateStr = dateStr;
				lastSpeakerId = null; // Reset spreker zodat er geen extra witruimte komt na de datum
			}

			const time = new Date(m.time).toLocaleTimeString("nl-NL", {
				hour: "2-digit",
				minute: "2-digit",
			});

			// NIEUW: Check op userId voor persistentie, fallback naar socket id
			const currentId = socket ? socket.id || mySocketId : null;
			const isLocal = (m.userId && m.userId === myUserId) || (!m.userId && ((currentId && m.id === currentId) || m.user === "Jij"));

			// NIEUW: Bepaal kleur van de naam
			let nameColor = m.color;
			if (!nameColor) {
				if (isLocal) nameColor = myColor;
				else if (otherPlayers[m.id]) nameColor = otherPlayers[m.id].color;
				else nameColor = "#ffffff"; // Fallback wit
			}

			// NIEUW: Toon naam als de spreker verandert
			if (m.userId !== lastSpeakerId) {
				if (lastSpeakerId !== null) {
					const spacer = document.createElement("div");
					spacer.style.height = "10px";
					content.appendChild(spacer);
				}

				const nameDiv = document.createElement("div");
				nameDiv.style.fontSize = "12px";
				nameDiv.style.fontWeight = "bold";
				nameDiv.style.color = nameColor;
				nameDiv.style.marginBottom = "2px";
				nameDiv.style.padding = "0 4px";
				nameDiv.style.textAlign = isLocal ? "left" : "right";
				nameDiv.textContent = m.user;
				content.appendChild(nameDiv);
			}

			const bubble = document.createElement("div");
			bubble.style.marginBottom = "2px";
			bubble.style.wordBreak = "break-word";
			// WhatsApp-stijl bubbels
			bubble.style.backgroundColor = "rgba(26, 26, 26, 0.9)";
			bubble.style.padding = "6px 10px";
			bubble.style.borderRadius = "12px";
			bubble.style.width = "fit-content";
			bubble.style.maxWidth = "85%";
			bubble.style.display = "flex";
			bubble.style.flexDirection = "column";
			bubble.style.minWidth = "60px";

			if (isLocal) {
				bubble.style.marginRight = "auto";
				bubble.style.borderBottomLeftRadius = "2px";
				bubble.style.textAlign = "left";
			} else {
				bubble.style.marginLeft = "auto";
				bubble.style.borderBottomRightRadius = "2px";
				bubble.style.textAlign = "left";
			}

			let displayText = m.text;
			// NIEUW: Styling voor acties (*...*)
			if (displayText.startsWith("*") && displayText.endsWith("*")) {
				displayText = `<span style="font-style: italic; color: #aaa;">${displayText}</span>`;
			}

			const msgSpan = document.createElement("span");
			msgSpan.innerHTML = displayText;
			msgSpan.style.lineHeight = "1.4";

			const timeSpan = document.createElement("span");
			timeSpan.textContent = time;
			timeSpan.style.fontSize = "10px";
			timeSpan.style.color = "#aaa";
			timeSpan.style.alignSelf = "flex-end";
			timeSpan.style.marginTop = "2px";
			timeSpan.style.marginLeft = "8px";

			bubble.appendChild(msgSpan);
			bubble.appendChild(timeSpan);

			content.appendChild(bubble);

			// Update de laatste spreker
			lastSpeakerId = m.userId;
		});

		content.scrollTop = content.scrollHeight;
	}

	// NIEUW: Check of er een muur staat tussen twee tegels
	function isWallBetween(t1, t2) {
		if (t1.x !== t2.x) {
			const wallX = Math.max(t1.x, t2.x);
			return objects.some((o) => o.isWall && !o.isGate && o.flipped && o.x === wallX && o.y === t1.y);
		}
		if (t1.y !== t2.y) {
			const wallY = Math.max(t1.y, t2.y);
			return objects.some((o) => o.isWall && !o.isGate && !o.flipped && o.x === t1.x && o.y === wallY);
		}
		return false;
	}

	function findPath(start, end) {
		const openSet = [];
		const closedSet = new Set();
		const cameFrom = new Map();

		function nodeKey(n) {
			return `${n.x},${n.y}`;
		}

		const gScore = {};
		const fScore = {};

		gScore[nodeKey(start)] = 0;
		fScore[nodeKey(start)] = Math.abs(start.x - end.x) + Math.abs(start.y - end.y);

		openSet.push({ ...start, f: fScore[nodeKey(start)] });

		while (openSet.length > 0) {
			// Kies node met laagste f
			openSet.sort((a, b) => a.f - b.f);
			const current = openSet.shift();

			if (current.x === end.x && current.y === end.y) {
				// Reconstruct path
				const path = [];
				let currKey = nodeKey(current);
				while (cameFrom.has(currKey)) {
					path.push(cameFrom.get(currKey));
					currKey = nodeKey(cameFrom.get(currKey));
				}
				path.reverse();

				// Voeg het eindpunt zelf toe zodat de speler er echt naartoe gaat
				path.push({ x: end.x, y: end.y });

				return path;
			}

			closedSet.add(nodeKey(current));

			// buren inclusief diagonalen
			const neighbors = [
				{ x: current.x + 1, y: current.y },
				{ x: current.x - 1, y: current.y },
				{ x: current.x, y: current.y + 1 },
				{ x: current.x, y: current.y - 1 },
				{ x: current.x + 1, y: current.y + 1 },
				{ x: current.x + 1, y: current.y - 1 },
				{ x: current.x - 1, y: current.y + 1 },
				{ x: current.x - 1, y: current.y - 1 },
			].filter((n) => n.x >= 0 && n.x < mapW && n.y >= 0 && n.y < mapH);

			for (let neighbor of neighbors) {
				const nKey = nodeKey(neighbor);
				if (closedSet.has(nKey)) continue;
				if (isBlocked(neighbor.x, neighbor.y, true)) continue;

				// NIEUW: Check of de beweging geblokkeerd wordt door een muur
				let wallBlocked = false;
				const dx = neighbor.x - current.x;
				const dy = neighbor.y - current.y;

				if (Math.abs(dx) + Math.abs(dy) === 1) {
					// Cardinale beweging (Recht)
					if (isWallBetween(current, neighbor)) wallBlocked = true;
				} else {
					// Diagonale beweging: Check of een van de cardinale paden geblokkeerd is
					const c1 = { x: current.x + dx, y: current.y };
					const c2 = { x: current.x, y: current.y + dy };
					if (isWallBetween(current, c1) || isWallBetween(c1, neighbor) || isWallBetween(current, c2) || isWallBetween(c2, neighbor)) {
						wallBlocked = true;
					}
				}
				if (wallBlocked) continue;

				const tentativeG = gScore[nodeKey(current)] + 1;

				if (!gScore.hasOwnProperty(nKey) || tentativeG < gScore[nKey]) {
					cameFrom.set(nKey, { x: current.x, y: current.y });
					gScore[nKey] = tentativeG;
					fScore[nKey] = tentativeG + Math.abs(neighbor.x - end.x) + Math.abs(neighbor.y - end.y);
					if (!openSet.some((n) => n.x === neighbor.x && n.y === neighbor.y)) {
						openSet.push({ ...neighbor, f: fScore[nKey] });
					}
				}
			}
		}

		// geen pad gevonden
		return [];
	}

	// Tile naar scherm
	function toScreen(ix, iy) {
		const sx = ((ix - iy) * tileW) / 2;
		const sy = ((ix + iy) * tileH) / 2;
		return { sx, sy };
	}

	function toTile(mx, my) {
		const w = toWorld(mx, my);
		return { x: Math.floor(w.x), y: Math.floor(w.y) };
	}

	function toWorld(mx, my) {
		// Converteert schermcoördinaten (muis) naar wereldcoördinaten (isometrisch)
		const worldMouseX = (mx - window.innerWidth / 2 - camX) / scale;
		const worldMouseY = (my - window.innerHeight / 4 - camY) / scale;

		// Inverse transformatie van toScreen
		const isoX = worldMouseX / (tileW / 2);
		const isoY = worldMouseY / (tileH / 2);

		const worldX = (isoX + isoY) / 2;
		const worldY = (isoY - isoX) / 2;
		return { x: worldX, y: worldY };
	}

	function wrapText(text, maxWidth) {
		const words = text.split(" ");
		const lines = [];
		let line = "";

		for (let word of words) {
			// Check of het woord zelf al te breed is
			if (ctx.measureText(word).width > maxWidth) {
				// Eerst de huidige regel opslaan
				if (line !== "") {
					lines.push(line);
					line = "";
				}

				// Breek het woord op
				let part = "";
				for (let char of word) {
					const test = part + char;
					if (ctx.measureText(test + "-").width > maxWidth) {
						lines.push((part + "-").trim());
						part = char;
					} else {
						part = test;
					}
				}
				line = part; // Het resterende deel wordt de nieuwe regel
			} else {
				const testLine = line + word + " ";
				if (ctx.measureText(testLine).width > maxWidth) {
					// Voeg de vorige regel toe, maar alleen als deze niet leeg is
					if (line.trim() !== "") lines.push(line.trim());
					line = word + " ";
				} else {
					line = testLine;
				}
			}
		}

		// Voeg de allerlaatste regel toe, maar alleen als deze niet leeg is
		if (line.trim() !== "") lines.push(line.trim());
		return lines;
	}

	function drawTiles() {
		for (let y = 0; y < mapH; y++) {
			for (let x = 0; x < mapW; x++) {
				const { sx, sy } = toScreen(x, y);
				const tileKey = `${x},${y}`;

				// Basis tegel
				let fill = "#444";

				// Check of er een custom kleur is voor deze tegel (dit overschrijft de basiskleur)
				if (tileColors[tileKey]) {
					fill = tileColors[tileKey];
				}

				ctx.beginPath();
				ctx.moveTo(sx, sy);
				ctx.lineTo(sx + tileW / 2, sy + tileH / 2);
				ctx.lineTo(sx, sy + tileH);
				ctx.lineTo(sx - tileW / 2, sy + tileH / 2);
				ctx.closePath();
				ctx.fillStyle = fill;
				ctx.fill();

				if (showTileNumbers) {
					// Tile nummer tekenen
					ctx.save();
					ctx.imageSmoothingEnabled = true; // Maak tekst tijdelijk glad
					ctx.fillStyle = "white";
					ctx.font = "10px Arial";
					ctx.textAlign = "center";
					ctx.textBaseline = "middle";
					const tileNum = y * mapW + x; // nummer van 0 t/m mapW*mapH-1
					ctx.fillText(tileNum, sx, sy + tileH / 2);
					ctx.restore(); // Herstelt imageSmoothingEnabled naar de default (false)
				}
			}
		}

		// Bouwmodus hover (plaatsen & verplaatsen)
		const activeObj = selectedBuildObject || movingObject;
		const isWallObject = activeObj && (activeObj.placement === "wall" || activeObj.wallId);

		if (isWallObject && hoverTarget?.type === "wall") {
			// Preview voor muurobjecten
			const wallId = hoverTarget.id;
			const isValidPlacement = true;

			// Teken de preview direct in de juiste wall-draw functie
			// We voegen een tijdelijke vlag toe aan hoverTarget
			hoverTarget.preview = {
				color: isValidPlacement ? "rgba(123, 255, 0, 0.5)" : "rgba(244, 67, 54, 0.5)",
				image: activeObj.runtimeImage || wallItemImg,
				valid: isValidPlacement,
			};
		} else if (hoverTarget?.preview) {
			// Reset de preview als we niet meer hoveren
			delete hoverTarget.preview;
		}
	}

	function drawCharacter(
		x,
		y,
		isLocal,
		color = "blue",
		hop = 0,
		isSmoking = false,
		smokingStartTime = 0,
		smokingItemType = "sigaret",
		isDrinking = false,
		drinkingStartTime = 0,
		drinkingItemType = "bottle_full"
	) {
		const drawXPos = isLocal ? ball.x : x;
		const drawYPos = isLocal ? ball.y : y;
		const currentHop = isLocal ? hopOffset : hop;

		const { sx, sy } = toScreen(drawXPos, drawYPos);

		const capsuleWidth = 32;
		const capsuleHeight = 48;
		const radius = capsuleWidth / 2;

		// Onderkant capsule = tegel midden
		const drawY = sy - currentHop - capsuleHeight;

		// Capsule speler
		ctx.fillStyle = color; // Gebruik de spelerskleur voor het lijfje
		ctx.beginPath();
		ctx.moveTo(sx - capsuleWidth / 2, drawY + radius);
		ctx.arcTo(sx - capsuleWidth / 2, drawY + capsuleHeight, sx + capsuleWidth / 2, drawY + capsuleHeight, radius);
		ctx.arcTo(sx + capsuleWidth / 2, drawY + capsuleHeight, sx + capsuleWidth / 2, drawY, radius);
		ctx.arcTo(sx + capsuleWidth / 2, drawY, sx - capsuleWidth / 2, drawY, radius);
		ctx.arcTo(sx - capsuleWidth / 2, drawY, sx - capsuleWidth / 2, drawY + capsuleHeight, radius);
		ctx.closePath();
		ctx.fill();

		// NIEUW: Rook animatie
		if (isSmoking) {
			const mouthX = sx + 6;
			const mouthY = drawY + 14;

			// Bepaal welke sigaret we tekenen
			let cigImg = sigaretStickImg;

			if (smokingItemType === "sigaret_half") {
				cigImg = sigaretHalfStickImg; // Direct de halve als we die roken
			} else {
				const elapsed = Date.now() - (smokingStartTime || Date.now());
				cigImg = elapsed < 5000 ? sigaretStickImg : sigaretHalfStickImg; // Anders wissel na 5s
			}

			// Teken de sigaret in de mond, -90 graden gedraaid
			ctx.save();
			ctx.imageSmoothingEnabled = false;
			ctx.translate(mouthX, mouthY);
			ctx.rotate(-Math.PI / 2); // -90 graden
			// Teken gecentreerd en met de bovenkant op het rotatiepunt
			const imgWidth = cigImg.width || 16;
			ctx.drawImage(cigImg, -imgWidth / 2, 0);
			ctx.restore();

			// Rookwolkjes
			const cigTipX = mouthX;
			const cigTipY = mouthY + (cigImg.width || 16); // Positie van het uiteinde

			ctx.save();
			// if (ctx.filter !== undefined) ctx.filter = 'blur(4px)'; // Blur uit voor grainy effect

			const numParticles = 25; // Meer deeltjes voor meer "ruis"
			for (let i = 0; i < numParticles; i++) {
				// Elke particle heeft zijn eigen cyclus en offset voor variatie
				const cycleDuration = 3000 + i * 150; // Iets snellere cyclus voor meer chaos
				const offset = i * (cycleDuration / numParticles);
				const t = ((Date.now() + offset) % cycleDuration) / cycleDuration; // Levensduur van 0 tot 1

				if (t < 0.05) continue; // Niet tekenen direct bij het uiteinde

				// Ruis toevoegen (pseudo-random op basis van index i)
				const noiseFactor = Math.sin(i * 999);
				const spread = noiseFactor * 15 * t; // Spreiding neemt toe naarmate rook stijgt

				const rise = t * 60; // Hoe ver de rook opstijgt
				const drift = Math.sin(t * Math.PI * 1.5) * 20; // Langzame S-curve voor de algemene richting
				const turbulence = Math.sin(t * Math.PI * 8 + i) * (1 - t) * 15; // Snellere turbulentie

				const px = cigTipX + drift + turbulence + spread;
				const py = cigTipY - rise;

				// Grootte groeit en krimpt dan weer voor een "puff" effect
				// Ruis in grootte
				const sizeNoise = Math.cos(i * 50) * 3;
				const size = Math.max(1, Math.sin(t * Math.PI) * 12 + sizeNoise);
				const alpha = Math.max(0, 0.4 * (1 - t * t)); // Iets transparanter voor rokeriger effect

				ctx.fillStyle = `rgba(220, 220, 220, ${alpha})`;

				// Grainy effect: teken wolkje van losse pixels i.p.v. cirkel
				const grains = Math.max(1, size * 2);
				for (let g = 0; g < grains; g++) {
					ctx.fillRect(px + (Math.random() - 0.5) * size * 2, py + (Math.random() - 0.5) * size * 2, 2, 2);
				}
			}
			ctx.restore();
		}

		// NIEUW: Drink animatie
		if (isDrinking) {
			const mouthX = sx + 10;
			const mouthY = drawY + 14;

			const elapsed = Date.now() - (drinkingStartTime || Date.now());

			let bottleImg = bottleFullImg;
			if (drinkingItemType === "bottle_half") bottleImg = bottleHalfImg;
			else if (drinkingItemType === "bottle_empty") bottleImg = bottleEmptyImg;
			else if (drinkingItemType === "bottle_full" && elapsed > 2000) bottleImg = bottleHalfImg;

			// Fles kantelen naar mond
			const baseAngle = Math.PI * 0.7; // Schuine hoek
			const wobble = Math.sin(elapsed * 0.008) * 0.1; // Beetje beweging

			ctx.save();
			ctx.imageSmoothingEnabled = false;
			ctx.translate(mouthX, mouthY);
			ctx.scale(-1, 1);
			ctx.rotate(baseAngle + wobble);

			const imgWidth = bottleImg.width || 16;
			const imgHeight = bottleImg.height || 32;

			ctx.drawImage(bottleImg, -imgWidth / 2, 0, imgWidth, imgHeight);
			ctx.restore();
		}
	}

	function drawBall() {
		drawCharacter(
			ball.x,
			ball.y,
			true,
			myColor,
			0,
			isSmoking,
			ball.smokingStartTime,
			ball.smokingItemType,
			isDrinking,
			ball.drinkingStartTime,
			ball.drinkingItemType
		);
	}

	// Achterwand
	function drawTopWall() {
		const wallHeight = globalWallHeight;
		// Loop van achter naar voren voor correcte diepte
		for (let x = mapW - 1; x >= 0; x--) {
			const wallId = `top_${x}`;
			const topLeft = toScreen(x, 0);
			const topRight = toScreen(x + 1, 0);

			// Teken altijd eerst de basiskleur van de muur
			const baseColor = wallColors[wallId] || "#555";
			ctx.fillStyle = baseColor;
			ctx.beginPath();
			ctx.moveTo(topLeft.sx, topLeft.sy - wallHeight);
			ctx.lineTo(topRight.sx, topRight.sy - wallHeight);
			ctx.lineTo(topRight.sx, topRight.sy);
			ctx.lineTo(topLeft.sx, topLeft.sy);
			ctx.closePath();
			ctx.fill();

			// NIEUW: 15% overlay voor diepte op de rechtermuur
			ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
			ctx.fill();

			// NIEUW: Teken de bovenkant van de muur (dikte)
			const capThickness = globalWallThickness;
			// Bereken offset naar "achteren" (-Y richting voor top muur)
			const backOff = toScreen(0, -capThickness);

			const p1 = { x: topLeft.sx, y: topLeft.sy - wallHeight };
			const p2 = { x: topRight.sx, y: topRight.sy - wallHeight };
			const p3 = { x: topRight.sx + backOff.sx, y: topRight.sy - wallHeight + backOff.sy };
			const p4 = { x: topLeft.sx + backOff.sx, y: topLeft.sy - wallHeight + backOff.sy };

			// 1. Teken basiskleur
			ctx.fillStyle = baseColor;
			ctx.beginPath();
			ctx.moveTo(p1.x, p1.y);
			ctx.lineTo(p2.x, p2.y);
			ctx.lineTo(p3.x, p3.y);
			ctx.lineTo(p4.x, p4.y);
			ctx.closePath();
			ctx.fill();
			// 2. Teken overlay (0.35 zwart voor plafond rechts)
			ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
			ctx.fill();

			// NIEUW: Teken het hoekstukje van de muur als we bij de hoek zijn (x=0)
			if (x === 0) {
				const c1 = toScreen(0, 0);
				const c2 = toScreen(-capThickness, 0);
				const c3 = toScreen(-capThickness, -capThickness);
				const c4 = toScreen(0, -capThickness);

				// Gradient voor een strakke punt (op basis van de muurkleuren)
				const leftWallColor = wallColors["left_0"] || "#666";
				const grad = ctx.createLinearGradient(c2.sx, c2.sy, c4.sx, c4.sy);
				grad.addColorStop(0, leftWallColor);
				grad.addColorStop(1, baseColor);

				ctx.fillStyle = grad;
				ctx.beginPath();
				ctx.moveTo(c1.sx, c1.sy - wallHeight);
				ctx.lineTo(c2.sx, c2.sy - wallHeight);
				ctx.lineTo(c3.sx, c3.sy - wallHeight);
				ctx.lineTo(c4.sx, c4.sy - wallHeight);
				ctx.closePath();
				ctx.fill();

				// Overlay over de hoek (45% links naar 35% rechts)
				const overlayGrad = ctx.createLinearGradient(c2.sx, c2.sy, c4.sx, c4.sy);
				overlayGrad.addColorStop(0, "rgba(0, 0, 0, 0.45)");
				overlayGrad.addColorStop(1, "rgba(0, 0, 0, 0.35)");
				ctx.fillStyle = overlayGrad;
				ctx.fill();
			}

			// NIEUW: Teken de zijkant van de muur aan het einde van de map
			if (x === mapW - 1) {
				const floorThickness = 8; // Match met drawFloorThickness

				// 1. Basiskleur
				ctx.fillStyle = baseColor;
				ctx.beginPath();
				ctx.moveTo(topRight.sx, topRight.sy + floorThickness);
				ctx.lineTo(topRight.sx, topRight.sy - wallHeight);
				ctx.lineTo(topRight.sx + backOff.sx, topRight.sy - wallHeight + backOff.sy);
				ctx.lineTo(topRight.sx + backOff.sx, topRight.sy + backOff.sy + floorThickness);
				ctx.closePath();
				ctx.fill();

				// 2. Overlay (0.35 zwart voor rechterkant)
				ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
				ctx.fill();
			}

			// Teken een eventueel muurobject
			const objectsStartingOnWall = wallObjects.filter((wo) => wo.wallId === wallId);
			objectsStartingOnWall.forEach((wallObject) => {
				if (!wallObject.isFree) {
					// Grid-based tekening
					const width = parseInt(wallObject.width || 1);
					const endSegmentX = x + width - 1;
					if (endSegmentX >= mapW) return; // Object gaat buiten de map

					const endTopRight = toScreen(endSegmentX + 1, 0);
					const objX = (topLeft.sx + endTopRight.sx) / 2;
					const objY = topLeft.sy;
					const img = wallObject.runtimeImage || (width > 1 ? wallItem2Img : wallItemImg);
					const yOffset = width > 1 ? 32 : 16;

					ctx.save();
					if (
						isBuildMode &&
						(buildTool === "move" || buildTool === "delete") &&
						!movingObject &&
						hoveredObjects[moveSelectionIndex] === wallObject
					) {
						ctx.filter = buildTool === "delete" ? "sepia(1) hue-rotate(-50deg) saturate(5)" : "brightness(1.5)";
					} else {
						// NIEUW: Diepte overlay voor objecten op rechtermuur (15% donkerder)
						ctx.filter = "brightness(0.85)";
					}

					if (wallObject.isCustom && wallObject.xOffset !== undefined) {
						const drawX = objX - wallObject.xOffset;
						const drawY = objY - wallObject.yOffset;
						if (wallObject.flipped) {
							ctx.scale(-1, 1);
							ctx.drawImage(img, -drawX - img.width, drawY);
						} else {
							ctx.drawImage(img, drawX, drawY);
						}
					} else {
						if (wallObject.flipped) {
							ctx.scale(-1, 1);
							ctx.drawImage(img, -objX - img.width / 2, objY - img.height + yOffset);
						} else {
							ctx.drawImage(img, objX - img.width / 2, objY - img.height + yOffset);
						}
					}
					ctx.restore();
				}
			});

			// Teken de highlight eroverheen als de muis erboven is (NA de objecten)
			if (hoverTarget && hoverTarget.type === "wall" && hoverTarget.id === wallId) {
				ctx.fillStyle = "rgba(255,255,255,0.5)";
				ctx.fill(); // Gebruik hetzelfde pad
			}

			// Teken de preview voor een nieuw muurobject
			const activeObj = movingObject || selectedBuildObject;
			const isWallObject = activeObj && (activeObj.placement === "wall" || activeObj.wallId);
			if (isWallObject && hoverTarget?.type === "wall" && hoverTarget.id === wallId) {
				if (!activeObj.isFree) {
					// OUDE LOGICA
					const width = parseInt(activeObj.width || 1);
					const endSegmentX = x + width - 1;
					if (endSegmentX >= mapW) return;

					const color = "rgba(123, 255, 0, 0.5)";
					const endTopRight = toScreen(endSegmentX + 1, 0);

					ctx.fillStyle = color;
					ctx.beginPath();
					ctx.moveTo(topLeft.sx, topLeft.sy - wallHeight);
					ctx.lineTo(endTopRight.sx, endTopRight.sy - wallHeight);
					ctx.lineTo(endTopRight.sx, endTopRight.sy);
					ctx.lineTo(topLeft.sx, topLeft.sy);
					ctx.closePath();
					ctx.fill();

					const objX = (topLeft.sx + endTopRight.sx) / 2;
					const objY = topLeft.sy;
					const img = activeObj.runtimeImage || (width > 1 ? wallItem2Img : wallItemImg);
					const yOffset = width > 1 ? 32 : 16;
					ctx.globalAlpha = 0.7;

					if (activeObj.isCustom && activeObj.xOffset !== undefined) {
						const drawX = objX - activeObj.xOffset;
						const drawY = objY - activeObj.yOffset;
						if (isBuildObjectFlipped) {
							ctx.save();
							ctx.scale(-1, 1);
							ctx.drawImage(img, -drawX - img.width, drawY);
							ctx.restore();
						} else {
							ctx.drawImage(img, drawX, drawY);
						}
					} else {
						if (isBuildObjectFlipped) {
							ctx.save();
							ctx.scale(-1, 1);
							ctx.drawImage(img, -objX - img.width / 2, objY - img.height + yOffset);
							ctx.restore();
						} else {
							ctx.drawImage(img, objX - img.width / 2, objY - img.height + yOffset);
						}
					}
					ctx.globalAlpha = 1;
				}
			}
		}
	}

	// Linkermuur
	function drawLeftWall() {
		const wallHeight = globalWallHeight;
		// Loop van achter naar voren
		for (let y = mapH - 1; y >= 0; y--) {
			const wallId = `left_${y}`;
			const leftTop = toScreen(0, y);
			const leftBottom = toScreen(0, y + 1);

			// Teken altijd eerst de basiskleur van de muur
			const baseColor = wallColors[wallId] || "#666";
			ctx.fillStyle = baseColor;
			ctx.beginPath();
			ctx.moveTo(leftTop.sx, leftTop.sy - wallHeight);
			ctx.lineTo(leftBottom.sx, leftBottom.sy - wallHeight);
			ctx.lineTo(leftBottom.sx, leftBottom.sy);
			ctx.lineTo(leftTop.sx, leftTop.sy);
			ctx.closePath();
			ctx.fill();

			// NIEUW: Teken de bovenkant van de muur (dikte)
			const capThickness = globalWallThickness;
			// Bereken offset naar "achteren" (-X richting voor linker muur)
			const backOff = toScreen(-capThickness, 0);

			const p1 = { x: leftTop.sx, y: leftTop.sy - wallHeight };
			const p2 = { x: leftBottom.sx, y: leftBottom.sy - wallHeight };
			const p3 = { x: leftBottom.sx + backOff.sx, y: leftBottom.sy - wallHeight + backOff.sy };
			const p4 = { x: leftTop.sx + backOff.sx, y: leftTop.sy - wallHeight + backOff.sy };

			// 1. Basiskleur
			ctx.fillStyle = baseColor;
			ctx.beginPath();
			ctx.moveTo(p1.x, p1.y);
			ctx.lineTo(p2.x, p2.y);
			ctx.lineTo(p3.x, p3.y);
			ctx.lineTo(p4.x, p4.y);
			ctx.closePath();
			ctx.fill();

			// 2. Overlay (0.45 zwart voor plafond)
			ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
			ctx.fill();

			// NIEUW: Teken de zijkant van de muur aan het einde van de map
			if (y === mapH - 1) {
				const floorThickness = 8; // Match met drawFloorThickness

				// 1. Basiskleur
				ctx.fillStyle = baseColor;
				ctx.beginPath();
				ctx.moveTo(leftBottom.sx, leftBottom.sy + floorThickness);
				ctx.lineTo(leftBottom.sx, leftBottom.sy - wallHeight);
				ctx.lineTo(leftBottom.sx + backOff.sx, leftBottom.sy - wallHeight + backOff.sy);
				ctx.lineTo(leftBottom.sx + backOff.sx, leftBottom.sy + backOff.sy + floorThickness);
				ctx.closePath();
				ctx.fill();

				// 2. Overlay (0.25 zwart voor linkerkant)
				ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
				ctx.fill();
			}

			// Teken een eventueel muurobject
			const objectsStartingOnWall = wallObjects.filter((wo) => wo.wallId === wallId);
			objectsStartingOnWall.forEach((wallObject) => {
				if (!wallObject.isFree) {
					// Grid-based tekening
					const width = parseInt(wallObject.width || 1);
					const endSegmentY = y + width - 1;
					if (endSegmentY >= mapH) return;

					const endLeftBottom = toScreen(0, endSegmentY + 1);
					const objX = (leftTop.sx + endLeftBottom.sx) / 2;
					const objY = leftTop.sy;
					const img = wallObject.runtimeImage || (width > 1 ? wallItem2Img : wallItemImg);
					const yOffset = width > 1 ? 32 : 16;

					const drawY = leftTop.sy;
					ctx.save();
					if (
						isBuildMode &&
						(buildTool === "move" || buildTool === "delete") &&
						!movingObject &&
						hoveredObjects[moveSelectionIndex] === wallObject
					) {
						ctx.filter = buildTool === "delete" ? "sepia(1) hue-rotate(-50deg) saturate(5)" : "brightness(1.5)";
					}

					if (wallObject.isCustom && wallObject.xOffset !== undefined) {
						const drawX = objX - wallObject.xOffset;
						const drawY = objY - wallObject.yOffset;
						if (wallObject.flipped) {
							ctx.scale(-1, 1);
							ctx.drawImage(img, -drawX - img.width, drawY);
						} else {
							ctx.drawImage(img, drawX, drawY);
						}
					} else {
						if (wallObject.flipped) {
							ctx.scale(-1, 1);
							ctx.drawImage(img, -objX - img.width / 2, drawY - img.height + yOffset);
						} else {
							ctx.drawImage(img, objX - img.width / 2, drawY - img.height + yOffset);
						}
					}
					ctx.restore();
				}
			});

			// Teken de highlight eroverheen als de muis erboven is (NA de objecten)
			if (hoverTarget && hoverTarget.type === "wall" && hoverTarget.id === wallId) {
				ctx.fillStyle = "rgba(255,255,255,0.5)";
				ctx.fill(); // Gebruik hetzelfde pad
			}

			// Teken de preview voor een nieuw muurobject
			const activeObj = movingObject || selectedBuildObject;
			const isWallObject = activeObj && (activeObj.placement === "wall" || activeObj.wallId);
			if (isWallObject && hoverTarget?.type === "wall" && hoverTarget.id === wallId) {
				if (!activeObj.isFree) {
					// OUDE LOGICA
					const width = parseInt(activeObj.width || 1);
					const endSegmentY = y + width - 1;
					if (endSegmentY >= mapH) return;

					const color = "rgba(123, 255, 0, 0.5)";
					const endLeftBottom = toScreen(0, endSegmentY + 1);

					ctx.fillStyle = color;
					ctx.beginPath();
					ctx.moveTo(leftTop.sx, leftTop.sy - wallHeight);
					ctx.lineTo(endLeftBottom.sx, endLeftBottom.sy - wallHeight);
					ctx.lineTo(endLeftBottom.sx, endLeftBottom.sy);
					ctx.lineTo(leftTop.sx, leftTop.sy);
					ctx.closePath();
					ctx.fill();

					const objX = (leftTop.sx + endLeftBottom.sx) / 2;
					const objY = leftTop.sy;
					const img = activeObj.runtimeImage || (width > 1 ? wallItem2Img : wallItemImg);
					const yOffset = width > 1 ? 32 : 16;
					ctx.globalAlpha = 0.7;
					if (activeObj.isCustom && activeObj.xOffset !== undefined) {
						const drawX = objX - activeObj.xOffset;
						const drawY = objY - activeObj.yOffset;
						if (isBuildObjectFlipped) {
							ctx.save();
							ctx.scale(-1, 1);
							ctx.drawImage(img, -drawX - img.width, drawY);
							ctx.restore();
						} else {
							ctx.drawImage(img, drawX, drawY);
						}
					} else {
						if (isBuildObjectFlipped) {
							ctx.save();
							ctx.scale(-1, 1);
							ctx.drawImage(img, -objX - img.width / 2, objY - img.height + yOffset);
							ctx.restore();
						} else {
							ctx.drawImage(img, objX - img.width / 2, objY - img.height + yOffset);
						}
					}
					ctx.globalAlpha = 1;
				}
			}
		}
	}

	function drawFreeWallObjects() {
		// 1. Geplaatste vrije objecten
		const freeObjects = wallObjects.filter((wo) => wo.isFree);

		freeObjects.forEach((wallObject) => {
			const objX = wallObject.freeX;
			const objY = wallObject.freeY;
			const img = wallObject.runtimeImage || (wallObject.width === 2 ? wallFree2Img : wallFreeImg);

			ctx.save();
			// Highlight logic
			if (
				isBuildMode &&
				(buildTool === "move" || buildTool === "delete") &&
				!movingObject &&
				hoveredObjects[moveSelectionIndex] === wallObject
			) {
				ctx.filter = buildTool === "delete" ? "sepia(1) hue-rotate(-50deg) saturate(5)" : "brightness(1.5)";
			}

			if (wallObject.flipped) {
				ctx.scale(-1, 1);
				ctx.drawImage(img, -objX - img.width / 2, objY - img.height + 40);
			} else {
				ctx.drawImage(img, objX - img.width / 2, objY - img.height + 40);
			}
			ctx.restore();
		});

		// 2. Preview voor vrije objecten
		const activeObj = movingObject || selectedBuildObject;
		const isWallObject = activeObj && (activeObj.placement === "wall" || activeObj.wallId);

		if (isWallObject && activeObj.isFree && hoverTarget?.type === "wall") {
			const img = activeObj.runtimeImage || (activeObj.width === 2 ? wallFree2Img : wallFreeImg);
			ctx.globalAlpha = 0.7;
			if (isBuildObjectFlipped) {
				ctx.save();
				ctx.scale(-1, 1);
				ctx.drawImage(img, -mouseWorldX - img.width / 2, mouseWorldY - img.height + 40);
				ctx.restore();
			} else {
				ctx.drawImage(img, mouseWorldX - img.width / 2, mouseWorldY - img.height + 40);
			}
			ctx.globalAlpha = 1;
		}
	}

	// NIEUW: Functie om de dikte van de vloer te tekenen (fundering)
	function drawFloorThickness() {
		const thickness = 8; // Hoogte van de vloerrand in pixels (dunner gemaakt)

		// 1. Linker-voorzijde (langs y-as, bij x=mapW)
		// We tekenen de randen van de tegels aan de uiterste rechterkant van de grid
		// Dit loopt van (mapW, 0) tot (mapW, mapH)
		for (let y = 0; y < mapH; y++) {
			// Haal de kleur op van de tegel aan de rand (mapW-1, y)
			const tileKey = `${mapW - 1},${y}`;
			const baseColor = tileColors[tileKey] || "#444";

			const pTop = toScreen(mapW, y);
			const pBottom = toScreen(mapW, y + 1);

			// 1. Basiskleur
			ctx.fillStyle = baseColor;
			ctx.beginPath();
			ctx.moveTo(pTop.sx, pTop.sy);
			ctx.lineTo(pBottom.sx, pBottom.sy);
			ctx.lineTo(pBottom.sx, pBottom.sy + thickness);
			ctx.lineTo(pTop.sx, pTop.sy + thickness);
			ctx.closePath();
			ctx.fill();

			// 2. Overlay (0.35 zwart voor rechterkant)
			ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
			ctx.fill();
		}

		// 2. Rechter-voorzijde (langs x-as, bij y=mapH)
		// Dit loopt van (0, mapH) tot (mapW, mapH)
		for (let x = 0; x < mapW; x++) {
			// Haal de kleur op van de tegel aan de rand (x, mapH-1)
			const tileKey = `${x},${mapH - 1}`;
			const baseColor = tileColors[tileKey] || "#444";

			const pLeft = toScreen(x, mapH);
			const pRight = toScreen(x + 1, mapH);

			// 1. Basiskleur
			ctx.fillStyle = baseColor;
			ctx.beginPath();
			ctx.moveTo(pLeft.sx, pLeft.sy);
			ctx.lineTo(pRight.sx, pRight.sy);
			ctx.lineTo(pRight.sx, pRight.sy + thickness);
			ctx.lineTo(pLeft.sx, pLeft.sy + thickness);
			ctx.closePath();
			ctx.fill();

			// 2. Overlay (0.25 zwart voor linkerkant)
			ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
			ctx.fill();
		}
	}

	let lastTypingTime = 0;
	const typingFadeStart = 3000; // 3 seconden wachten na laatste type
	const typingFadeDuration = 1000; // fade tijd 1 seconde

	function getActiveBalloonCount() {
		const now = Date.now();
		const currentId = socket ? socket.id || mySocketId : "local";
		return chatMessages.filter((m) => {
			const isMe = (m.userId && m.userId === myUserId) || (!m.userId && (m.id === currentId || m.id === "local"));
			return isMe && now - m.time < m.duration;
		}).length;
	}

	chatInput.addEventListener("input", () => {
		const activeCount = getActiveBalloonCount();

		// ❌ blokkeren bij 5 ballonnen
		if (activeCount >= 5) {
			chatInput.value = "";
			chatInput.disabled = true;
			chatInput.placeholder = "Even wachten...";
			charCounter.textContent = `0 / ${MAX_CHARS}`;
			return;
		}

		// ✅ weer mogen typen
		chatInput.disabled = false;
		chatInput.placeholder = "Typ hier je bericht...";
		chatInput.style.color = "#000";

		lastTypingTime = Date.now();

		if (chatInput.value.length > MAX_CHARS) {
			chatInput.value = chatInput.value.slice(0, MAX_CHARS);
		}

		// Update char counter
		charCounter.textContent = `${chatInput.value.length} / ${MAX_CHARS}`;
		charCounter.style.color = chatInput.value.length >= MAX_CHARS ? "#ff4d4d" : "#aaa";
	});

	// Zorg dat het canvas meeschaalt met het venster
	window.addEventListener("resize", () => {
		const dpr = window.devicePixelRatio || 1;
		canvas.width = window.innerWidth * dpr;
		canvas.height = window.innerHeight * dpr;
		canvas.style.width = window.innerWidth + "px";
		canvas.style.height = window.innerHeight + "px";
		ctx.imageSmoothingEnabled = false; // Opnieuw instellen na resize
	});

	window.addEventListener("keydown", (e) => {
		const active = document.activeElement;

		// NIEUW: Project Window Shortcuts & Isolatie
		if (document.getElementById("projectWindow").style.display === "flex") {
			// Transform Shortcuts
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "t") {
				e.stopPropagation(); // Stop event bubbling
				e.preventDefault();
				setActiveProjectTool("transform");
				return;
			}

			// NIEUW: Project Undo (Cmd+Z)
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
				e.preventDefault();
				undoProjectAction();
				return;
			}

			if (isTransforming) {
				if (e.key === "Enter") {
					applyTransform();
					return;
				}
				// Esc wordt hieronder afgehandeld
			}

			// Pijltjestoetsen voor verplaatsen (Transformatie, Selectie, Laag)
			if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
				e.preventDefault();
				const step = e.shiftKey ? 10 : 1;
				let dx = 0;
				let dy = 0;

				if (e.key === "ArrowUp") dy = -step;
				if (e.key === "ArrowDown") dy = step;
				if (e.key === "ArrowLeft") dx = -step;
				if (e.key === "ArrowRight") dx = step;

				if (isTransforming) {
					// Verplaats transform overlay (scherm pixels, dus * zoom)
					const currentLeft = parseFloat(transformOverlay.style.left);
					const currentTop = parseFloat(transformOverlay.style.top);
					const newLeft = currentLeft + dx * projectZoom;
					const newTop = currentTop + dy * projectZoom;

					transformOverlay.style.left = newLeft + "px";
					transformOverlay.style.top = newTop + "px";

					if (activeLayerId) {
						const layer = projectLayers.find((l) => l.id === activeLayerId);
						if (layer) {
							layer.canvas.style.left = newLeft + "px";
							layer.canvas.style.top = newTop + "px";
						}
					}
				} else if (selectionRect) {
					// Verplaats selectie kader
					selectionRect.x += dx;
					selectionRect.y += dy;
					updateSelectionOverlay();
				} else if (activeLayerId) {
					// Verplaats actieve laag
					const layer = projectLayers.find((l) => l.id === activeLayerId);
					if (layer) {
						layer.x += dx; // dx is 1 of 10 logical pixels
						layer.y += dy;
						layer.canvas.style.left = `${layer.x * projectZoom}px`;
						layer.canvas.style.top = `${layer.y * projectZoom}px`;
					}
				}
				return;
			}

			// Tools
			if (e.key.toLowerCase() === "b") {
				setActiveProjectTool("brush");
				e.preventDefault();
				return;
			}
			if (e.key.toLowerCase() === "s") {
				setActiveProjectTool("select");
				e.preventDefault();
				return;
			}
			if (e.key.toLowerCase() === "h") {
				setActiveProjectTool("hand");
				e.preventDefault();
				return;
			}

			// Brush/Eraser grootte ([ en ])
			if (e.key === "[" || e.key === "]") {
				const delta = e.key === "]" ? 1 : -1;
				const step = e.shiftKey ? 5 : 1;

				if (currentProjectTool === "brush") {
					projectToolSettings.brush.size = Math.max(1, Math.min(100, projectToolSettings.brush.size + delta * step));
					updateProjectSubHeader();
				} else if (currentProjectTool === "eraser") {
					projectToolSettings.eraser.size = Math.max(1, Math.min(100, projectToolSettings.eraser.size + delta * step));
					updateProjectSubHeader();
				}
				e.preventDefault();
				return;
			}

			// Layer Delete Shortcut (Cmd/Ctrl + Backspace)
			// Als er een selectie is, verwijder alleen de pixels in de selectie
			if (e.key === "Backspace") {
				if (selectionRect && activeLayerId) {
					e.preventDefault();
					const layer = projectLayers.find((l) => l.id === activeLayerId);
					if (layer) {
						// Coördinaten relatief aan de laag
						saveProjectState(); // Save before delete
						const sx = selectionRect.x - layer.x;
						const sy = selectionRect.y - layer.y;
						layer.ctx.clearRect(sx, sy, selectionRect.w, selectionRect.h);
					}
					return;
				} else if (e.metaKey || e.ctrlKey) {
					e.preventDefault();
					deleteActiveLayer();
					return;
				}
			}

			// Copy (Cmd/Ctrl + C)
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
				if (selectionRect && activeLayerId) {
					e.preventDefault();
					const layer = projectLayers.find((l) => l.id === activeLayerId);
					if (layer) {
						const sx = Math.floor(selectionRect.x - layer.x);
						const sy = Math.floor(selectionRect.y - layer.y);
						const sw = Math.floor(selectionRect.w);
						const sh = Math.floor(selectionRect.h);

						if (sw > 0 && sh > 0) {
							projectClipboard = layer.ctx.getImageData(sx, sy, sw, sh);
							showNotification("Gekopieerd!");
						}
					}
				}
				return;
			}

			// Paste (Cmd/Ctrl + V)
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
				if (projectClipboard) {
					e.preventDefault();
					// Paste maakt nieuwe laag, dus geen undo van bestaande laag nodig (kan laag verwijderen als undo)
					const newLayer = addLayer("Geplakte Laag", projectClipboard.width, projectClipboard.height);
					// Plak op de plek van de selectie, of linksboven als er geen selectie is
					const px = selectionRect ? Math.floor(selectionRect.x) : 0;
					const py = selectionRect ? Math.floor(selectionRect.y) : 0;
					newLayer.x = px;
					newLayer.y = py;
					newLayer.canvas.style.left = `${newLayer.x * projectZoom}px`;
					newLayer.canvas.style.top = `${newLayer.y * projectZoom}px`;
					newLayer.ctx.putImageData(projectClipboard, 0, 0);
					showNotification("Geplakt in nieuwe laag!");
				}
				return;
			}

			// Zoom shortcuts (Cmd/Ctrl + 0, -, +/=)
			if (e.metaKey || e.ctrlKey) {
				if (e.key === "0") {
					e.preventDefault();
					fitProjectCanvas();
					return;
				} else if (e.key === "=" || e.key === "+") {
					e.preventDefault();
					let step = 0.1;
					if (projectZoom >= 5) step = 1.0;
					else if (projectZoom >= 1) step = 0.5;

					projectZoom = Math.min(projectZoom + step, 128);
					updateProjectTransform();
					return;
				} else if (e.key === "-") {
					e.preventDefault();
					let step = 0.1;
					if (projectZoom > 5) step = 1.0;
					else if (projectZoom > 1) step = 0.5;

					projectZoom = Math.max(projectZoom - step, 0.1);
					updateProjectTransform();
					return;
				}
			}

			// Blokkeer alle andere game-interacties (zoals chat focus)
			return;
		}

		// Pong pauze toggle met ESC
		if (e.key === "Escape") {
			if (isTransforming) {
				cancelTransform();
				setActiveProjectTool("hand");
				return;
			}

			if (document.getElementById("pongGame").style.display === "flex") {
				if (!isPongAI && socket && currentPongOpponentId) {
					// PvP: Vraag server om pauze
					socket.emit("requestPongPause", { opponentId: currentPongOpponentId });
				} else {
					// AI: Lokale pauze
					initiatePongPause("Jij");
				}
				return; // Stop verdere ESC afhandeling
			}

			// Cancel bouwacties
			if (isBuildMode) {
				if (selectedBuildObject) {
					selectedBuildObject = null;
					const selectedItem = document.querySelector(".build-item.selected");
					if (selectedItem) {
						selectedItem.classList.remove("selected");
						isBuildObjectFlipped = false;
					}
				}
				if (movingObject) {
					objects.push(movingObject); // Zet het object terug
					movingObject = null;
					movePreview.style.display = "none";
				}
			}

			// Cancel item dragging
			if (isItemDragging && draggedItem) {
				if (dragImageElement) {
					dragImageElement.remove();
					dragImageElement = null;
				}

				if (isDraggingFromInventory) {
					inventoryItems.push(draggedItem);
					renderInventoryItems();
				} else if (isDraggingFromShop) {
					shopOutputItems.push(draggedItem);
					renderShopOutput();
				} else {
					if (draggedItemOriginalPos) {
						draggedItem.x = draggedItemOriginalPos.x;
						draggedItem.y = draggedItemOriginalPos.y;
						items.push(draggedItem); // Zet item terug
					}
				}
				isItemDragging = false;
				isDraggingFromInventory = false;
				isDraggingFromShop = false;
				isDraggingFromVicinity = false;
				draggedItem = null;
				draggedItemOriginalPos = null;

				// Heropen de vensters die open stonden
				if (windowStatesBeforeDrag) {
					if (windowStatesBeforeDrag.chat) document.getElementById("chatLog").style.display = windowStatesBeforeDrag.chat;
					if (windowStatesBeforeDrag.inventory) document.getElementById("inventory").style.display = windowStatesBeforeDrag.inventory;
					if (windowStatesBeforeDrag.vicinity) document.getElementById("vicinityWindow").style.display = windowStatesBeforeDrag.vicinity;
					if (windowStatesBeforeDrag.build === "flex") {
						buildBtn.click();
					}
					if (windowStatesBeforeDrag.shop === "flex") {
						document.getElementById("shopWindow").style.display = "flex";
					}
					if (windowStatesBeforeDrag.container === "flex") {
						document.getElementById("containerWindow").style.display = "flex";
					}
					if (windowStatesBeforeDrag.paper === "flex") {
						document.getElementById("paperWindow").style.display = "flex";
					}
					if (windowStatesBeforeDrag.newProject === "flex") {
						document.getElementById("newProjectWindow").style.display = "flex";
					}
					windowStatesBeforeDrag = null;
				}
			}

			// Cancel object dragging (moveable objects)
			if (isObjectDragging && draggedObject) {
				draggedObject.x = draggedObjectOriginalPos.x;
				draggedObject.y = draggedObjectOriginalPos.y;
				const { runtimeImage, ...objectToSend } = draggedObject;
				socket.emit("placeObject", objectToSend);
				draggedObject = null;
				draggedObjectOriginalPos = null;
				isObjectDragging = false;
				movePreview.style.display = "none";

				if (camOriginalPos) {
					camTargetX = camOriginalPos.x;
					camTargetY = camOriginalPos.y;
					camSmooth = true;
					camOriginalPos = null;
				}

				if (windowStatesBeforeDrag) {
					if (windowStatesBeforeDrag.chat) document.getElementById("chatLog").style.display = windowStatesBeforeDrag.chat;
					if (windowStatesBeforeDrag.inventory) document.getElementById("inventory").style.display = windowStatesBeforeDrag.inventory;
					if (windowStatesBeforeDrag.vicinity) document.getElementById("vicinityWindow").style.display = windowStatesBeforeDrag.vicinity;
					if (windowStatesBeforeDrag.build === "flex") {
						if (!isBuildMode) buildBtn.click();
					}
					if (windowStatesBeforeDrag.shop === "flex") {
						document.getElementById("shopWindow").style.display = "flex";
					}
					if (windowStatesBeforeDrag.marker === "flex") document.getElementById("markerMenu").style.display = "flex";
					if (windowStatesBeforeDrag.pouch === "flex") {
						document.getElementById("pouchWindow").style.display = "flex";
					}
					if (windowStatesBeforeDrag.container === "flex") {
						document.getElementById("containerWindow").style.display = "flex";
					}
					if (windowStatesBeforeDrag.paper === "flex") {
						document.getElementById("paperWindow").style.display = "flex";
					}
					if (windowStatesBeforeDrag.newProject === "flex") {
						document.getElementById("newProjectWindow").style.display = "flex";
					}
					windowStatesBeforeDrag = null;
				}
			}
		}

		// Selectie in verplaats-menu met pijltjestoetsen
		if (isBuildMode && (buildTool === "move" || buildTool === "delete") && !movingObject && hoveredObjects.length > 1) {
			if (e.key === "ArrowUp") {
				moveSelectionIndex = (moveSelectionIndex - 1 + hoveredObjects.length) % hoveredObjects.length;
				updateMovePreviewContent();
				e.preventDefault();
				return;
			} else if (e.key === "ArrowDown") {
				moveSelectionIndex = (moveSelectionIndex + 1) % hoveredObjects.length;
				updateMovePreviewContent();
				e.preventDefault();
				return;
			}
		}

		// Pong start met Spatie
		if (e.code === "Space") {
			if (document.getElementById("pongGame").style.display === "flex" && !pongGameStarted) {
				pongGameStarted = true;
				pongRunning = true;
				e.preventDefault(); // Voorkom typen in chat
				return;
			}
		}

		// Als we in bouwmodus zijn, handel alleen de rotatie af.
		if (
			isBuildMode &&
			(activeBuildCategory === "objecten" || activeBuildCategory === "wallbuild") &&
			(selectedBuildObject || movingObject || buildTool === "place_wall")
		) {
			if (e.key.toLowerCase() === "r") {
				isBuildObjectFlipped = !isBuildObjectFlipped;
				// Als we een object verplaatsen, update ook de 'flipped' state van dat object direct.
				if (movingObject) {
					movingObject.flipped = isBuildObjectFlipped;
				}
			}
			return; // Stop verdere keyboard-logica in bouwmodus
		}

		// Als we een moveable object aan het slepen zijn (buiten bouwmodus)
		if (isObjectDragging && draggedObject) {
			if (e.key.toLowerCase() === "r") {
				draggedObject.flipped = !draggedObject.flipped;
				e.preventDefault(); // Voorkom dat 'r' in de chat komt
			}
			return; // Stop verdere afhandeling (geen chat focus)
		}

		// NIEUW: Undo functionaliteit (Cmd+Z of Ctrl+Z)
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
			e.preventDefault();
			if (undoStack.length > 0) {
				const marksToRemove = undoStack.pop();
				const idsToRemove = marksToRemove.map((m) => m.id);

				// Optimistic update: verwijder lokaal
				activeMarks = activeMarks.filter((m) => !idsToRemove.includes(m.id));
				if (socket) socket.emit("undoMarks", idsToRemove);
			}
		}

		// ❌ Geen bouwmodus: focus de chat, maar sluit speciale toetsen uit
		if (
			active !== chatInput &&
			active.tagName !== "INPUT" &&
			active.id !== "customObjectName" &&
			active.tagName !== "TEXTAREA" &&
			!["Shift", "Control", "Alt", "Meta", "Enter"].includes(e.key)
		) {
			chatInput.focus();
		}

		// Enter = bericht versturen
		if (active === chatInput && e.key === "Enter") {
			if (chatInput.value.trim() !== "") {
				sendChatMessage(chatInput.value.trim());
				chatInput.value = "";
				charCounter.textContent = `0 / ${MAX_CHARS}`;
				charCounter.style.color = "#aaa";
			}
			e.preventDefault();
		}
	});

	function fitProjectCanvas() {
		const workspace = document.getElementById("projectWorkspace");
		const canvas = projectCanvasWrapper.querySelector("canvas");
		if (!workspace || !canvas) return;

		const wsRect = workspace.getBoundingClientRect();
		// Gebruik de interne resolutie van het canvas
		const cWidth = canvas.width;
		const cHeight = canvas.height;

		// Bereken schaal om te passen (met 40px marge)
		const scaleX = (wsRect.width - 40) / cWidth;
		const scaleY = (wsRect.height - 40) / cHeight;

		projectZoom = Math.min(scaleX, scaleY);
		updateProjectTransform();
	}

	function initiatePongPause(name) {
		if (isPongPaused) return; // Al gepauzeerd

		isPongPaused = true;
		pongPauseInitiator = name;
		pongPauseCountdown = 5;
		updatePongCursorState(false); // Cursor zichtbaar maken

		if (pongPauseInterval) clearInterval(pongPauseInterval);
		pongPauseInterval = setInterval(() => {
			pongPauseCountdown--;
			if (pongPauseCountdown <= 0) {
				// Hervat spel
				clearInterval(pongPauseInterval);
				isPongPaused = false;
				updatePongCursorState(true); // Cursor verbergen
			}
		}, 1000);
	}

	function drawChatBallon() {
		const now = Date.now();

		const paddingX = 16;
		const paddingY = 12;
		const maxWidth = 200;
		const minWidth = 60;
		const lineHeight = 18;
		const gap = 18;
		const fadeTime = 1000;
		const offsetAbovePlayer = 48 * scale + 40; // Dynamische afstand op basis van zoom

		// Helper om positie te bepalen
		function getPlayerPosition(id) {
			// Als het bericht van onszelf is (of id is 'local'/'undefined' in singleplayer)
			if (!id || (socket && id === socket.id) || id === "local") {
				return { x: ball.x, y: ball.y, hop: hopOffset };
			}
			// Als het van een andere speler is
			if (otherPlayers[id]) {
				return { x: otherPlayers[id].x, y: otherPlayers[id].y, hop: 0 };
			}
			return null;
		}

		// Groepeer berichten per speler ID
		const messagesByPlayer = {};

		// 1. Bestaande berichten
		chatMessages.forEach((m) => {
			if (now - m.time < m.duration) {
				const id = m.id || "local";
				if (!messagesByPlayer[id]) messagesByPlayer[id] = [];
				messagesByPlayer[id].push(m);
			}
		});

		// 2. Typing indicator (alleen voor onszelf)
		const timeSinceLastType = now - lastTypingTime;
		const typingActive = lastTypingTime > 0 && chatInput.value.length > 0 && timeSinceLastType < typingFadeStart + typingFadeDuration;

		if (typingActive) {
			const myId = socket ? socket.id : "local";
			if (!messagesByPlayer[myId]) messagesByPlayer[myId] = [];
			messagesByPlayer[myId].push({
				text: "...",
				isTyping: true,
				time: lastTypingTime,
				id: myId,
			});
		}

		// 3. Bereken afmetingen en posities (Eerste pass)
		ctx.save();
		ctx.imageSmoothingEnabled = true; // Maak de tekstballon en tekst glad (UI element)
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // Schaal UI mee met DPI
		ctx.font = "14px Arial";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";

		const balloonGroups = [];

		Object.keys(messagesByPlayer).forEach((playerId) => {
			const pos = getPlayerPosition(playerId);
			if (!pos) return;

			const stack = messagesByPlayer[playerId];
			const world = toScreen(pos.x, pos.y);
			const screenX = world.sx * scale + window.innerWidth / 2 + camX;
			const screenY = world.sy * scale + window.innerHeight / 4 + camY - pos.hop * scale;

			// Bereken offsets
			let totalOffset = 0;
			const balloonData = [];
			let groupMaxWidth = 0;

			// Van nieuw naar oud (stacken)
			for (let i = stack.length - 1; i >= 0; i--) {
				const m = stack[i];
				const lines = wrapText(m.text, maxWidth - paddingX * 2);
				const height = lines.length * lineHeight + paddingY * 2;

				const textWidth = Math.max(...lines.map((l) => ctx.measureText(l).width));
				const width = Math.max(minWidth, Math.min(maxWidth, textWidth + paddingX * 2));
				if (width > groupMaxWidth) groupMaxWidth = width;

				balloonData.push({
					msg: m,
					lines: lines,
					height: height,
					width: width,
					offset: totalOffset,
				});

				totalOffset += height + gap;
			}

			if (balloonData.length > 0) {
				const totalHeight = totalOffset - gap; // Laatste gap niet meetellen voor bounding box
				balloonGroups.push({
					playerId: playerId,
					screenX: screenX, // Oorspronkelijke X (boven speler)
					screenY: screenY,
					anchorY: screenY - offsetAbovePlayer, // Onderkant van de stapel
					x: screenX, // Huidige X (kan verschuiven)
					y: screenY - offsetAbovePlayer - totalHeight / 2, // Midden Y van de hele groep
					width: groupMaxWidth,
					height: totalHeight,
					balloons: balloonData,
				});
			}
		});

		// 4. Collision Resolution (Duw ballonnen uit elkaar)
		const iterations = 5; // Aantal keer proberen op te lossen
		for (let iter = 0; iter < iterations; iter++) {
			for (let i = 0; i < balloonGroups.length; i++) {
				for (let j = i + 1; j < balloonGroups.length; j++) {
					const g1 = balloonGroups[i];
					const g2 = balloonGroups[j];

					// Check overlap (met wat padding)
					const padding = 10;
					const dx = g1.x - g2.x;
					const dy = g1.y - g2.y;
					const combinedHalfWidth = g1.width / 2 + g2.width / 2 + padding;
					const combinedHalfHeight = g1.height / 2 + g2.height / 2 + padding;

					if (Math.abs(dx) < combinedHalfWidth && Math.abs(dy) < combinedHalfHeight) {
						// Overlap gedetecteerd! Duw ze horizontaal uit elkaar.
						const overlapX = combinedHalfWidth - Math.abs(dx);

						// Bepaal richting (als ze precies op elkaar staan, duw op basis van index)
						let dir = dx > 0 ? 1 : -1;
						if (dx === 0) dir = i < j ? -1 : 1;

						const push = overlapX / 2;
						g1.x += dir * push;
						g2.x -= dir * push;
					}
				}
			}
		}

		// 5. Teken de ballonnen op hun nieuwe posities
		balloonGroups.forEach((group) => {
			// Clamp binnen schermranden
			const margin = group.width / 2 + 10;
			if (group.x < margin) group.x = margin;
			if (group.x > window.innerWidth - margin) group.x = window.innerWidth - margin;

			group.balloons.forEach((data) => {
				const { msg, lines, height, width, offset } = data;

				// Alpha berekening
				let alpha = 1;
				if (!msg.isTyping) {
					const age = now - msg.time;
					if (age > msg.duration - fadeTime) {
						alpha = 1 - (age - (msg.duration - fadeTime)) / fadeTime;
					}
				} else {
					if (timeSinceLastType > typingFadeStart) {
						alpha = 1 - (timeSinceLastType - typingFadeStart) / typingFadeDuration;
					}
				}

				// Gebruik de aangepaste X positie van de groep
				const drawX = group.x;
				const targetY = group.anchorY - offset - height;
				const r = lines.length === 1 ? height / 2 : 14;

				ctx.globalAlpha = alpha;

				// Teken ballon vorm
				ctx.beginPath();
				ctx.moveTo(drawX - width / 2 + r, targetY);
				ctx.lineTo(drawX + width / 2 - r, targetY);
				ctx.quadraticCurveTo(drawX + width / 2, targetY, drawX + width / 2, targetY + r);
				ctx.lineTo(drawX + width / 2, targetY + height - r);
				ctx.quadraticCurveTo(drawX + width / 2, targetY + height, drawX + width / 2 - r, targetY + height);
				ctx.lineTo(drawX - width / 2 + r, targetY + height);
				ctx.quadraticCurveTo(drawX - width / 2, targetY + height, drawX - width / 2, targetY + height - r);
				ctx.lineTo(drawX - width / 2, targetY + r);
				ctx.quadraticCurveTo(drawX - width / 2, targetY, drawX - width / 2 + r, targetY);
				ctx.closePath();

				ctx.fillStyle = "white";
				ctx.fill();

				// Teken een klein puntje richting de speler als de ballon verschoven is
				// Alleen bij de onderste ballon
				if (offset === 0) {
					ctx.beginPath();
					// Start onderkant ballon
					ctx.moveTo(drawX, targetY + height);
					// Punt richting originele positie (hoofd speler)
					// We houden het subtiel: een klein driehoekje dat iets richting de speler wijst
					const tailX = (drawX + group.screenX) / 2;
					ctx.lineTo(tailX, targetY + height + 6);
					ctx.lineTo(drawX + (drawX < group.screenX ? 6 : -6), targetY + height);
					ctx.fill();
				}

				// NIEUW: Styling voor acties (*...*) in de ballon
				const isAction = typeof msg.text === "string" && msg.text.trim().startsWith("*") && msg.text.trim().endsWith("*");
				if (isAction) {
					ctx.font = "italic 14px Arial";
					ctx.fillStyle = "#666";
				} else {
					ctx.font = "14px Arial";
					ctx.fillStyle = "black";
				}

				// Teken tekst
				lines.forEach((line, i) => {
					ctx.fillText(line, drawX, targetY + paddingY + lineHeight / 2 + i * lineHeight);
				});

				ctx.globalAlpha = 1;
			});
		});

		ctx.restore();
	}

	function drawPlayerNames() {
		const playersToDraw = [];
		// Voeg lokale speler toe
		playersToDraw.push({
			x: ball.x,
			y: ball.y,
			hop: hopOffset,
			name: myName,
			id: "local",
		});

		// Voeg andere spelers toe
		Object.values(otherPlayers).forEach((p) => {
			playersToDraw.push({
				x: p.x,
				y: p.y,
				hop: p.hopOffset || 0,
				name: p.name,
				id: p.id,
			});
		});

		ctx.save();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // UI coördinaten (niet meeschalen met zoom voor tekstgrootte, wel positie)
		ctx.font = "12px Arial";
		ctx.textAlign = "center";
		ctx.textBaseline = "bottom";

		const now = Date.now();
		const fadeDuration = 2000; // 2 seconden fade-out

		playersToDraw.forEach((p) => {
			// Initialiseer state als die er nog niet is
			if (!nameHoverStates[p.id]) {
				nameHoverStates[p.id] = { opacity: 0, lastHover: 0 };
			}
			const state = nameHoverStates[p.id];

			const world = toScreen(p.x, p.y);
			const screenX = world.sx * scale + window.innerWidth / 2 + camX;
			const screenY = world.sy * scale + window.innerHeight / 4 + camY - p.hop * scale;

			// Hitbox berekening (ongeveer de grootte van de speler)
			const charHeight = 48 * scale;
			const charWidth = 32 * scale;

			// Check hover
			const isHovering =
				mousePos.x >= screenX - charWidth / 2 &&
				mousePos.x <= screenX + charWidth / 2 &&
				mousePos.y >= screenY - charHeight &&
				mousePos.y <= screenY;

			if (isHovering) {
				state.opacity = 1;
				state.lastHover = now;
			} else {
				// Fade out logica
				const timeSinceHover = now - state.lastHover;
				if (timeSinceHover < fadeDuration) {
					state.opacity = 1 - timeSinceHover / fadeDuration;
				} else {
					state.opacity = 0;
				}
			}

			if (state.opacity > 0) {
				const textWidth = ctx.measureText(p.name).width;
				const padding = 4;
				const tagY = screenY - charHeight - 5; // Iets boven het hoofd

				ctx.globalAlpha = state.opacity;

				// Achtergrondje
				ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
				ctx.fillRect(screenX - textWidth / 2 - padding, tagY - 14 - padding, textWidth + padding * 2, 14 + padding * 2);

				// Tekst
				ctx.fillStyle = "white";
				ctx.fillText(p.name, screenX, tagY);

				ctx.globalAlpha = 1.0; // Reset alpha
			}
		});

		ctx.restore();
	}

	function drawInteractionPrompts() {
		activeInteractionButton = null; // Reset elke frame
		const playerX = Math.floor(ball.x);
		const playerY = Math.floor(ball.y);

		objects.forEach((obj) => {
			// Check op functionaliteit via subCategory of interactionType (met fallback naar naam voor oude objecten)
			const isPong = obj.interactionType === "pong" || obj.name === "Pong";
			const isShop = obj.subCategory === "shop" || obj.name === "Winkel";
			const isContainer = obj.subCategory === "containers" || (obj.name && obj.name.includes("Container"));
			const isTrash = obj.subCategory === "trash" || (obj.name && obj.name.includes("Prullenbak"));
			const isTap = obj.interactionType === "tap";

			if (isPong || isShop || isContainer || isTrash || isTap) {
				const isFlipped = obj.flipped;
				const w = isFlipped ? obj.depth || 1 : obj.width || 1; // Pong=2x1, Winkel=1x1 (maar hoog)
				const d = isFlipped ? obj.width || 1 : obj.depth || 1;

				let spots = [];

				if (isShop) {
					if (obj.width >= 2 || obj.depth >= 2) {
						// Brede winkel: interactie aan de voorkant (zoals brede container)
						if (isFlipped) {
							// Verticale oriëntatie -> Interactie rechts (x+w)
							for (let i = 0; i < d; i++) {
								spots.push({ x: obj.x + w, y: obj.y + i });
							}
						} else {
							// Horizontale oriëntatie -> Interactie onder (y+d)
							for (let i = 0; i < w; i++) {
								spots.push({ x: obj.x + i, y: obj.y + d });
							}
						}
					} else {
						// Standaard Winkel heeft maar 1 interactiekant (voorkant)
						if (isFlipped) {
							spots.push({ x: obj.x, y: obj.y + 1 }); // Links-onder (y+1)
						} else {
							spots.push({ x: obj.x + 1, y: obj.y }); // Rechts-onder (x+1)
						}
					}
				} else if (isContainer || isTrash || isTap) {
					if (obj.width >= 2) {
						// Brede varianten (check op basis eigenschap width)
						// Speciale logica voor de brede container: interactie aan de 'voorkant' (onder/rechts)
						if (isFlipped) {
							// Verticale oriëntatie -> Interactie rechts (x+w)
							for (let i = 0; i < d; i++) {
								spots.push({ x: obj.x + w, y: obj.y + i });
							}
						} else {
							// Horizontale oriëntatie -> Interactie onder (y+d)
							for (let i = 0; i < w; i++) {
								spots.push({ x: obj.x + i, y: obj.y + d });
							}
						}
					} else {
						// Standaard logica voor andere containers (zoals het was)
						if (isFlipped) {
							spots.push({ x: obj.x, y: obj.y + 1 }); // Onder
						} else {
							spots.push({ x: obj.x + 1, y: obj.y }); // Rechts
						}
					}
				} else {
					// Pong heeft 2 kanten
					if (isFlipped) {
						// Verticaal: plekken boven en onder
						spots.push({ x: obj.x, y: obj.y - 1 });
						spots.push({ x: obj.x, y: obj.y + d });
					} else {
						// Horizontaal: plekken links en rechts
						spots.push({ x: obj.x - 1, y: obj.y });
						spots.push({ x: obj.x + w, y: obj.y });
					}
				}

				const isPlayerOnSpot = spots.some((s) => s.x === playerX && s.y === playerY);

				if (isPlayerOnSpot) {
					// Teken prompt
					const { sx, sy } = toScreen(ball.x, ball.y);
					const drawX = sx * scale + window.innerWidth / 2 + camX;
					const drawY = (sy - 80) * scale + window.innerHeight / 4 + camY - hopOffset * scale; // Boven speler

					ctx.save();
					ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // Reset transform voor UI, schaal mee met DPR

					// Teken pong prompt
					let promptImg = pongPromptImg;
					if (isShop) {
						promptImg = shopPromptImg;
					} else if (isTrash) {
						promptImg = trashPromptImg;
					} else if (isContainer) {
						promptImg = containerPromptImg;
					} else if (isTap) {
						promptImg = druppelPromptImg;
					}
					const imgW = promptImg.width || 32;
					const imgH = promptImg.height || 32;

					const time = Date.now();

					if (isContainer || isTrash || isTap) {
						// Animatie: zacht sprongetje (bounce)
						const bounce = Math.abs(Math.sin(time / 300)) * 8; // Springt 8px omhoog
						ctx.translate(drawX, drawY - bounce);
					} else {
						// Animatie: zachtjes wiebelen (rotatie)
						const angle = Math.sin(time / 200) * 0.2; // +/- 0.2 radialen
						ctx.translate(drawX, drawY); // Verplaats naar midden van prompt
						ctx.rotate(angle);
					}

					// Schaduw voor betere zichtbaarheid
					ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
					ctx.shadowBlur = 10;
					ctx.shadowOffsetX = 0;
					ctx.shadowOffsetY = 0;
					ctx.drawImage(promptImg, -imgW / 2, -imgH / 2);

					// Sla op voor click detectie
					activeInteractionButton = { x: drawX - imgW / 2, y: drawY - imgH / 2, w: imgW, h: imgH, obj: obj };

					ctx.restore();
				}
			}
		});
	}

	// NIEUW: Preview menu voor verplaatsen van objecten
	const movePreview = document.getElementById("movePreview");
	const movePreviewImg = document.getElementById("movePreviewImg");
	const movePreviewName = document.getElementById("movePreviewName");
	const movePreviewCount = document.getElementById("movePreviewCount");

	let hoveredObjects = [];
	let moveSelectionIndex = 0;
	let lastHoveredTileKey = "";
	let hoveredCustomWallForColor = null; // NIEUW: Voor highlight tijdens kleuren

	function getObjectImageSrc(obj) {
		if (obj.runtimeImage) return obj.runtimeImage.src;
		if (obj.image && typeof obj.image === "string") return obj.image;
		if (obj.image && obj.image.src) return obj.image.src; // Voor items

		if (obj.isWall) return "icons/wall_build.png";
		if (obj.name === "Pong") return "objects/pong.png";
		if (obj.name === "Winkel") return "winkel_template_96.png";
		if (obj.name === "Brede Winkel") return "winkel_template_96_B.png";
		if (obj.name === "Container") return "container_template.png";
		if (obj.name === "Kraan") return "templates/kraan_template.png";
		if (obj.name === "Hoge Kraan") return "templates/kraan_template_96.png";
		if (obj.name === "Grote Container") return "container_template_96.png";
		if (obj.name === "Brede Container") return "container_template_96_B.png";
		if (obj.name === "Prullenbak") return "trash_template.png";
		if (obj.name === "Brede Prullenbak") return "trash_template_96_B.png";
		if (obj.isFloor) return "floor_template.png";

		const isWide = obj.width === 2;
		const isTall = obj.height === 2;

		if (obj.moveable) {
			return isWide ? "object_moveable_template_96_B.png" : "object_moveable_template.png";
		}

		if (isWide) return "object_template_96_B.png";
		if (isTall) return "object_template_96.png";
		return "object_template.png";
	}

	function updateMovePreviewContent() {
		const objectToPreview = hoveredObjects[moveSelectionIndex];

		if (objectToPreview) {
			movePreview.style.display = "flex";

			if (movePreviewName.textContent !== objectToPreview.name) {
				movePreviewName.textContent = objectToPreview.name;
				movePreviewImg.src = getObjectImageSrc(objectToPreview);
			}

			// Update de actie tekst (Verplaatsen of Verwijderen)
			const actionText = document.getElementById("movePreviewActionText");
			if (actionText) {
				actionText.textContent = buildTool === "delete" ? "Verwijderen" : "Verplaatsen";
				actionText.style.color = buildTool === "delete" ? "#f44336" : "#ccc";
			}

			const priceText = document.getElementById("movePreviewPrice");
			if (priceText) {
				priceText.style.display = "none";
			}

			if (hoveredObjects.length > 1) {
				movePreviewCount.style.display = "block";
				movePreviewCount.textContent = `${moveSelectionIndex + 1}/${hoveredObjects.length} ↕`;
			} else {
				movePreviewCount.style.display = "none";
			}
		} else {
			movePreview.style.display = "none";
			movePreviewName.textContent = "";
		}
	}

	// NIEUW: Helper om te checken of muis op een muur staat
	function isMouseOverWall(obj, mx, my) {
		if (!obj.isWall) return false;
		const t = obj.wallThickness || 0.25;
		const h = obj.wallHeight || 150;
		const wx = obj.x;
		const wy = obj.y;
		let c1, c2, c3, c4;

		if (obj.flipped) {
			// Y-axis
			c1 = toScreen(wx - t, wy);
			c2 = toScreen(wx, wy);
			c3 = toScreen(wx, wy + 1);
			c4 = toScreen(wx - t, wy + 1);

			// NIEUW: Correcte polygoon voor Y-as muren (Top + East face)
			const poly = [
				{ sx: c1.sx, sy: c1.sy - h }, // Top-Back-Left
				{ sx: c2.sx, sy: c2.sy - h }, // Top-Front-Left
				{ sx: c2.sx, sy: c2.sy }, // Btm-Front-Left
				{ sx: c3.sx, sy: c3.sy }, // Btm-Front-Right
				{ sx: c3.sx, sy: c3.sy - h }, // Top-Front-Right
				{ sx: c4.sx, sy: c4.sy - h }, // Top-Back-Right
			];
			return isInside(mx, my, poly);
		} else {
			// X-axis
			c1 = toScreen(wx, wy - t);
			c2 = toScreen(wx + 1, wy - t);
			c3 = toScreen(wx + 1, wy);
			c4 = toScreen(wx, wy);

			const poly = [
				{ sx: c1.sx, sy: c1.sy - h },
				{ sx: c2.sx, sy: c2.sy - h },
				{ sx: c3.sx, sy: c3.sy - h },
				{ sx: c3.sx, sy: c3.sy },
				{ sx: c4.sx, sy: c4.sy },
				{ sx: c4.sx, sy: c4.sy - h },
			];
			return isInside(mx, my, poly);
		}
	}

	// NIEUW: Helper om te checken of er al een muur staat
	function isWallAt(x, y, flipped, excludeObject = null) {
		return objects.some((o) => o !== excludeObject && o.isWall && o.x === x && o.y === y && o.flipped === flipped);
	}

	window.addEventListener("mousemove", (e) => {
		// Toon de preview alleen als de 'verplaats' tool actief is, we over een object hoveren,
		// en we niet al een object aan het verplaatsen zijn.
		if (isBuildMode && (buildTool === "move" || buildTool === "delete") && !movingObject) {
			const x = hoverCell ? hoverCell.x : -1;
			const y = hoverCell ? hoverCell.y : -1;

			let tileKey = "";
			if (hoverTarget && hoverTarget.type === "wall") {
				tileKey = hoverTarget.id;
			} else if (hoverCell) {
				tileKey = `${x},${y}`;
			}

			if (tileKey !== lastHoveredTileKey) {
				const objectsOnTile = hoverCell
					? objects.filter((o) => {
							const w = o.flipped ? o.depth || 1 : o.width || 1;
							const d = o.flipped ? o.width || 1 : o.depth || 1;
							return x >= o.x && x < o.x + w && y >= o.y && y < o.y + d;
					  })
					: [];
				const itemsOnTile = hoverCell ? items.filter((i) => Math.floor(i.x) === x && Math.floor(i.y) === y) : [];

				// NIEUW: Check muren op basis van exacte muispositie (hit test)
				const mWorldX = (e.clientX - (window.innerWidth / 2 + camX)) / scale;
				const mWorldY = (e.clientY - (window.innerHeight / 4 + camY)) / scale;
				const wallObjectsOnHover = objects.filter((o) => isMouseOverWall(o, mWorldX, mWorldY));

				let wallObjs = [];
				if (hoverTarget && hoverTarget.type === "wall") {
					const currentWallSide = hoverTarget.id.split("_")[0];

					wallObjs = wallObjects.filter((o) => {
						if (o.isFree) {
							if (o.wallSide !== currentWallSide) return false;

							const img = o.runtimeImage || (o.width === 2 ? wallFree2Img : wallFreeImg);
							if (!img || !img.width) return false;

							const w = img.width;
							const h = img.height;
							const x1 = o.freeX - w / 2;
							const y1 = o.freeY - h + 40;

							return mouseWorldX >= x1 && mouseWorldX < x1 + w && mouseWorldY >= y1 && mouseWorldY < y1 + h;
						} else {
							if (o.wallId === hoverTarget.id) return true;
							const width = o.width || 1;
							if (width > 1) {
								const [hType, hIndex] = hoverTarget.id.split("_");
								const [oType, oIndex] = o.wallId.split("_");
								if (hType === oType) {
									const hIdx = parseInt(hIndex);
									const oIdx = parseInt(oIndex);
									return hIdx >= oIdx && hIdx < oIdx + width;
								}
							}
							return false;
						}
					});
				}

				hoveredObjects = [...objectsOnTile, ...itemsOnTile, ...wallObjs, ...wallObjectsOnHover];

				// Sorteer: Meubels eerst, dan vloeren
				hoveredObjects.sort((a, b) => {
					const isItemA = items.includes(a);
					const isItemB = items.includes(b);
					if (isItemA && !isItemB) return -1; // Items eerst
					if (!isItemA && isItemB) return 1;
					if (a.isFloor && !b.isFloor) return 1;
					if (!a.isFloor && b.isFloor) return -1;
					return 0;
				});

				moveSelectionIndex = 0;
				lastHoveredTileKey = tileKey;
			} else {
				// Check of objecten veranderd zijn (bijv. verwijderd)
				const currentObjects = hoverCell
					? objects.filter((o) => {
							const w = o.flipped ? o.depth || 1 : o.width || 1;
							const d = o.flipped ? o.width || 1 : o.depth || 1;
							return x >= o.x && x < o.x + w && y >= o.y && y < o.y + d;
					  })
					: [];
				const currentItems = hoverCell ? items.filter((i) => Math.floor(i.x) === x && Math.floor(i.y) === y) : [];

				const mWorldX = (e.clientX - (window.innerWidth / 2 + camX)) / scale;
				const mWorldY = (e.clientY - (window.innerHeight / 4 + camY)) / scale;
				const currentWallObjectsOnHover = objects.filter((o) => isMouseOverWall(o, mWorldX, mWorldY));

				let currentWallObjs = [];
				if (hoverTarget && hoverTarget.type === "wall") {
					const currentWallSide = hoverTarget.id.split("_")[0];
					currentWallObjs = wallObjects.filter((o) => {
						if (o.isFree) {
							if (o.wallSide !== currentWallSide) return false;
							const img = o.runtimeImage || (o.width === 2 ? wallFree2Img : wallFreeImg);
							if (!img || !img.width) return false;
							const w = img.width;
							const h = img.height;
							const x1 = o.freeX - w / 2;
							const y1 = o.freeY - h + 40;
							return mouseWorldX >= x1 && mouseWorldX < x1 + w && mouseWorldY >= y1 && mouseWorldY < y1 + h;
						} else {
							if (o.wallId === hoverTarget.id) return true;
							const width = o.width || 1;
							if (width > 1) {
								const [hType, hIndex] = hoverTarget.id.split("_");
								const [oType, oIndex] = o.wallId.split("_");
								if (hType === oType) {
									const hIdx = parseInt(hIndex);
									const oIdx = parseInt(oIndex);
									return hIdx >= oIdx && hIdx < oIdx + width;
								}
							}
							return false;
						}
					});
				}

				if (
					currentObjects.length + currentItems.length + currentWallObjs.length + currentWallObjectsOnHover.length !==
					hoveredObjects.length
				) {
					hoveredObjects = [...currentObjects, ...currentItems, ...currentWallObjs, ...currentWallObjectsOnHover];
					hoveredObjects.sort((a, b) => {
						const isItemA = items.includes(a);
						const isItemB = items.includes(b);
						if (isItemA && !isItemB) return -1;
						if (!isItemA && isItemB) return 1;
						if (a.isFloor && !b.isFloor) return 1;
						if (!a.isFloor && b.isFloor) return -1;
						return 0;
					});
					if (moveSelectionIndex >= hoveredObjects.length) moveSelectionIndex = 0;
				}
			}

			if (hoveredObjects.length > 0) {
				movePreview.style.left = e.clientX + 20 + "px";
				movePreview.style.top = e.clientY + "px";
				updateMovePreviewContent();
			} else {
				movePreview.style.display = "none";
			}
		} else if (
			isBuildMode &&
			(selectedBuildObject || movingObject) &&
			!(selectedBuildObject && selectedBuildObject.placement === "wall_structure")
		) {
			// NIEUW: Preview tijdens plaatsen (nieuw of verplaatsen)
			const obj = movingObject || selectedBuildObject;

			// NIEUW: Update positie van bewegende muur voor live preview
			if (movingObject && movingObject.isWall) {
				const worldPos = toWorld(e.clientX, e.clientY);
				const wx = worldPos.x;
				const wy = worldPos.y;

				if (movingObject.flipped) {
					movingObject.x = Math.round(wx);
					movingObject.y = Math.floor(wy);
				} else {
					movingObject.x = Math.floor(wx);
					movingObject.y = Math.round(wy);
				}
			}

			movePreview.style.display = "flex";
			movePreview.style.left = e.clientX + 20 + "px";
			movePreview.style.top = e.clientY + "px";

			movePreviewName.textContent = obj.name;
			movePreviewImg.src = getObjectImageSrc(obj);

			const actionText = document.getElementById("movePreviewActionText");
			if (actionText) {
				actionText.textContent = "[R] Roteren";
				actionText.style.color = "#ccc";
			}

			const priceText = document.getElementById("movePreviewPrice");
			if (priceText) {
				// Toon prijs alleen bij nieuw object (niet bij verplaatsen bestaand object)
				if (!movingObject && !isUserAdmin && obj.price) {
					priceText.textContent = `€${obj.price}`;
					priceText.style.display = "block";
				} else {
					priceText.style.display = "none";
				}
			}

			const countText = document.getElementById("movePreviewCount");
			if (countText) countText.style.display = "none";
		} else if (isBuildMode && (buildTool === "place_wall" || (selectedBuildObject && selectedBuildObject.placement === "wall_structure"))) {
			// NIEUW: Muur plaatsing met handmatige rotatie en snap-to-grid-line
			const worldPos = toWorld(e.clientX, e.clientY);
			const wx = worldPos.x;
			const wy = worldPos.y;

			// Snap logic: Rond af naar dichtstbijzijnde lijn loodrecht op de muur
			if (isBuildObjectFlipped) {
				// Verticaal (Y-as): Snap X naar lijn, Y naar tegel
				hoverCell = { x: Math.round(wx), y: Math.floor(wy) };
			} else {
				// Horizontaal (X-as): Snap Y naar lijn, X naar tegel
				hoverCell = { x: Math.floor(wx), y: Math.round(wy) };
			}

			// Check of we binnen de map (of op de rand) zitten
			// Voor muren mag je op de uiterste lijn zitten (dus <= mapW ipv < mapW)
			const isValid = isBuildObjectFlipped
				? hoverCell.x >= 0 && hoverCell.x <= mapW && hoverCell.y >= 0 && hoverCell.y < mapH
				: hoverCell.x >= 0 && hoverCell.x < mapW && hoverCell.y >= 0 && hoverCell.y <= mapH;

			if (isValid) {
				movePreview.style.display = "flex";
				movePreview.style.left = e.clientX + 20 + "px";
				movePreview.style.top = e.clientY + "px";
				movePreviewName.textContent = selectedBuildObject ? selectedBuildObject.name : "Muur";
				movePreviewImg.src = "icons/wall_build.png";

				const actionText = document.getElementById("movePreviewActionText");
				if (actionText) {
					actionText.textContent = "[R] Roteren | Klik plaatsen";
					actionText.style.color = "#ccc";
				}
				const priceText = document.getElementById("movePreviewPrice");
				if (priceText) priceText.style.display = "none";
				const countText = document.getElementById("movePreviewCount");
				if (countText) countText.style.display = "none";
			} else {
				movePreview.style.display = "none";
				hoverCell = null;
			}
		} else if (isBuildMode && activeBuildCategory === "kleur") {
			const mWorldX = (e.clientX - (window.innerWidth / 2 + camX)) / scale;
			const mWorldY = (e.clientY - (window.innerHeight / 4 + camY)) / scale;
			hoveredCustomWallForColor = objects
				.slice()
				.reverse()
				.find((o) => o.isWall && isMouseOverWall(o, mWorldX, mWorldY));

			movePreview.style.display = "none";
		} else {
			movePreview.style.display = "none";
			movePreviewName.textContent = "";
			hoveredObjects = [];
			moveSelectionIndex = 0;
			lastHoveredTileKey = "";
			hoveredCustomWallForColor = null;
		}
	});

	let mousePos = { x: 0, y: 0 };
	// Event listeners
	canvas.addEventListener("mousemove", (e) => {
		// Blokkeer hover-effecten in de hoofdkamer als Pong actief is
		if (pongRunning) return;

		mousePos = { x: e.clientX, y: e.clientY };

		const { x, y } = toTile(e.clientX, e.clientY);
		hoverCell = x >= 0 && x < mapW && y >= 0 && y < mapH ? { x, y } : null;

		// --- Hover detectie voor muren en tegels in bouwmodus ---
		if (isBuildMode) {
			hoverTarget = null;

			// NIEUW: Check of we muren moeten negeren (als we een vloerobject plaatsen)
			let checkWalls = true;
			const activeObj = movingObject || selectedBuildObject || (buildTool === "place_wall" ? { placement: "floor" } : null);
			if (activeObj) {
				const isFloorObj = (activeObj.placement === "floor" && !activeObj.wallId) || activeObj.isItem;
				if (isFloorObj) checkWalls = false;
			}

			const wallHeight = 150;
			mouseWorldX = (e.clientX - (window.innerWidth / 2 + camX)) / scale;
			mouseWorldY = (e.clientY - (window.innerHeight / 4 + camY)) / scale;

			if (checkWalls) {
				// Check top walls (van voor naar achter voor correcte selectie)
				for (let x = 0; x < mapW; x++) {
					const p1 = toScreen(x, 0);
					const p2 = toScreen(x + 1, 0);
					// Bounding box van het muursegment
					// We gebruiken een iets complexere check voor de isometrische vorm
					const inside = isInside(mouseWorldX, mouseWorldY, [
						p1,
						p2,
						{ sx: p2.sx, sy: p2.sy - wallHeight },
						{ sx: p1.sx, sy: p1.sy - wallHeight },
					]);
					if (inside) {
						hoverTarget = { type: "wall", id: `top_${x}` };
						break;
					}
				}

				// Als geen top-muur, check linker muren
				if (!hoverTarget) {
					for (let y = 0; y < mapH; y++) {
						const p1 = toScreen(0, y);
						const p2 = toScreen(0, y + 1);
						// Bounding box van het muursegment
						const inside = isInside(mouseWorldX, mouseWorldY, [
							p1,
							p2,
							{ sx: p2.sx, sy: p2.sy - wallHeight },
							{ sx: p1.sx, sy: p1.sy - wallHeight },
						]);
						if (inside) {
							hoverTarget = { type: "wall", id: `left_${y}` };
							break;
						}
					}
				}
			}

			// Als nog steeds geen muur, check voor een tegel
			if (!hoverTarget && hoverCell) {
				hoverTarget = { type: "tile", id: hoverCell };
			}
		}

		if (isCameraDragging) {
			// Gebruik de nieuwe variabele
			const dx = e.clientX - dragStart.x;
			const dy = e.clientY - dragStart.y;

			camX = camStart.x + dx;
			camY = camStart.y + dy;
		}

		// NIEUW: Cursor management (Marker & Kleur tools)
		const isColorToolActive = isBuildMode && activeBuildCategory === "kleur";
		const showCrosshair = (isMarkerMode && !isBuildMode) || isColorToolActive;

		if (showCrosshair && !isCameraDragging && !isObjectDragging && !isItemDragging) {
			canvas.style.cursor = "crosshair";
		} else {
			if (canvas.style.cursor === "crosshair") {
				canvas.style.cursor = "";
			}
		}

		// NIEUW: Tekenen op muren met actieve marker
		if (isMarkerMode && !isBuildMode && !isCameraDragging && !isObjectDragging && !isItemDragging) {
			const mWorldX = (e.clientX - (window.innerWidth / 2 + camX)) / scale;
			const mWorldY = (e.clientY - (window.innerHeight / 4 + camY)) / scale;

			// Zoek naar de specifieke muur onder de muis
			// We zoeken van achter naar voor (reverse) om de bovenste te pakken
			let targetWall = objects
				.slice()
				.reverse()
				.find((o) => o.isWall && isMouseOverWall(o, mWorldX, mWorldY));

			// NIEUW: Als geen custom muur, check boundary walls (statische muren)
			if (!targetWall) {
				// Check Top Walls (X-axis, y=0)
				for (let x = 0; x < mapW; x++) {
					const wallObj = { isWall: true, x: x, y: 0, flipped: false, wallHeight: globalWallHeight, wallThickness: globalWallThickness };
					if (isMouseOverWall(wallObj, mWorldX, mWorldY)) {
						targetWall = wallObj;
						break;
					}
				}
			}
			if (!targetWall) {
				// Check Left Walls (Y-axis, x=0)
				for (let y = 0; y < mapH; y++) {
					const wallObj = { isWall: true, x: 0, y: y, flipped: true, wallHeight: globalWallHeight, wallThickness: globalWallThickness };
					if (isMouseOverWall(wallObj, mWorldX, mWorldY)) {
						targetWall = wallObj;
						break;
					}
				}
			}

			if (targetWall) {
				// Als muisknop ingedrukt is (tekenen of gummen)
				if (e.buttons === 1) {
					// Bereken positie op de muur
					let wallX, wallY, wallZ;

					if (targetWall.flipped) {
						// Y-axis muur (vlak op X)
						// Projectie: y = wx - sx/32
						// z = (wx + y) * 16 - sy
						const wx = targetWall.x;
						const yOnWall = wx - mWorldX / 32;
						const zOnWall = (wx + yOnWall) * 16 - mWorldY;

						wallX = wx;
						wallY = yOnWall;
						wallZ = zOnWall;
					} else {
						// X-axis muur (vlak op Y)
						// Projectie: x = sx/32 + wy
						// z = (x + wy) * 16 - sy
						const wy = targetWall.y;
						const xOnWall = mWorldX / 32 + wy;
						const zOnWall = (xOnWall + wy) * 16 - mWorldY;

						wallX = xOnWall;
						wallY = wy;
						wallZ = zOnWall;
					}

					// NIEUW: Voorkom tekenen in de opening van een poort
					if (targetWall.isGate && wallZ < globalGateHeight) {
						lastMarkerPos = null;
						return;
					}

					if (markerTool === "draw") {
						// NIEUW: Interpolatie voor vloeiende lijnen
						const newMarks = [];
						if (lastMarkerPos) {
							const dx = wallX - lastMarkerPos.x;
							const dy = wallY - lastMarkerPos.y;
							const dz = wallZ - lastMarkerPos.z;

							// Bepaal aantal stappen op basis van resolutie (0.05 tegel of 2 pixels)
							const steps = Math.ceil(Math.max(Math.abs(dx) / 0.01, Math.abs(dy) / 0.01, Math.abs(dz) / 1));

							for (let i = 1; i < steps; i++) {
								const t = i / steps;
								const markId = Date.now() + "-" + Math.random().toString(36).substr(2, 9) + "-" + i;
								newMarks.push({
									x: lastMarkerPos.x + dx * t,
									y: lastMarkerPos.y + dy * t,
									z: lastMarkerPos.z + dz * t,
									life: 1.0,
									decayRate: 0, // 0 = Blijft staan
									sortOffset: 0.05,
									color: markerColor,
									size: markerSize,
									id: markId,
								});
							}
						}

						const markId = Date.now() + "-" + Math.random().toString(36).substr(2, 9);
						newMarks.push({
							x: wallX,
							y: wallY,
							z: wallZ,
							life: 1.0,
							decayRate: 0,
							sortOffset: 0.05,
							color: markerColor, // Gebruik geselecteerde kleur
							size: markerSize,
							id: markId,
						});

						activeMarks.push(...newMarks);
						currentStroke.push(...newMarks); // Voeg toe aan huidige stroke
						if (socket) socket.emit("placeMarks", newMarks);

						lastMarkerPos = { x: wallX, y: wallY, z: wallZ };
					} else if (markerTool === "erase") {
						let eSize = markerSize;
						if (eSize === 6) eSize = 10;
						const eraseRadius = eSize * 0.1; // Gum grootte schaalt mee
						const r2 = eraseRadius * eraseRadius;

						// Lokaal verwijderen (optimistic update)
						const initialLength = activeMarks.length;
						activeMarks = activeMarks.filter((m) => {
							const dx = m.x - wallX;
							const dy = m.y - wallY;
							const dz = m.z - wallZ;
							return dx * dx + dy * dy + dz * dz > r2;
						});

						if (activeMarks.length !== initialLength) {
							if (socket) socket.emit("removeMarks", { x: wallX, y: wallY, z: wallZ, radius: eraseRadius });
						}
						lastMarkerPos = null;
					}
				} else {
					lastMarkerPos = null;
				}
			} else {
				lastMarkerPos = null;
			}
		}
	});

	window.addEventListener("mousemove", (e) => {
		// --- Logica voor verplaatsen BINNEN inventaris ---
		if (isRearrangingInventory && activeInventoryItem && activeInventoryDiv) {
			const inventory = document.getElementById("inventory");
			const rect = inventory.getBoundingClientRect();

			// Check of we over de container zijn (voor drag-drop naar container)
			const containerWindow = document.getElementById("containerWindow");
			let isOverContainer = false;
			if (containerWindow && containerWindow.style.display === "flex") {
				const cRect = containerWindow.getBoundingClientRect();
				if (e.clientX >= cRect.left && e.clientX <= cRect.right && e.clientY >= cRect.top && e.clientY <= cRect.bottom) {
					isOverContainer = true;
				}
			}

			// Check of de muis BUITEN de inventaris komt -> Switch naar wereld-sleep
			if (isOverContainer || e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
				isRearrangingInventory = false;

				// Verwijder uit inventaris array
				const index = inventoryItems.indexOf(activeInventoryItem);
				if (index > -1) inventoryItems.splice(index, 1);

				// Verwijder de div uit de DOM
				if (activeInventoryDiv) activeInventoryDiv.remove();

				savePlayerData(); // Opslaan (item is eruit)

				// Start de wereld-sleep logica
				draggedItem = activeInventoryItem;
				isItemDragging = true;
				isDraggingFromInventory = true;
				draggedItemOriginalPos = null;

				// Maak het sleep-plaatje aan
				dragImageElement = document.createElement("img");
				dragImageElement.src = draggedItem.image.src;
				dragImageElement.style.position = "absolute";
				dragImageElement.style.pointerEvents = "none";
				dragImageElement.style.zIndex = "9999";
				dragImageElement.style.imageRendering = "pixelated";
				const w = (draggedItem.image.width || 64) * scale;
				const h = (draggedItem.image.height || 64) * scale;
				dragImageElement.style.width = w + "px";
				dragImageElement.style.left = e.clientX - w / 2 + "px";
				dragImageElement.style.top = e.clientY - h / 2 + "px";
				document.body.appendChild(dragImageElement);

				activeInventoryItem = null;
				activeInventoryDiv = null;
				return;
			}

			// Zolang we BINNEN de inventaris zijn: update positie
			const contentRect = document.getElementById("inventoryContent").getBoundingClientRect();
			const newX = e.clientX - contentRect.left - inventoryDragOffset.x;
			const newY = e.clientY - contentRect.top - inventoryDragOffset.y;

			activeInventoryItem.invX = newX;
			activeInventoryItem.invY = newY;

			activeInventoryDiv.style.left = newX + "px";
			activeInventoryDiv.style.top = newY + "px";
		}

		// Update draggedItem position if dragging (Global to allow dragging over inventory)
		if (isItemDragging && draggedItem) {
			const worldPos = toWorld(e.clientX, e.clientY);
			draggedItem.x = worldPos.x;
			draggedItem.y = worldPos.y;

			if (dragImageElement) {
				const w = (draggedItem.image.width || 64) * scale;
				const h = (draggedItem.image.height || 64) * scale;
				dragImageElement.style.width = w + "px";
				dragImageElement.style.left = e.clientX - w / 2 + "px";
				dragImageElement.style.top = e.clientY - h / 2 + "px";

				// NIEUW: Filter logic tijdens slepen
				const tx = Math.floor(worldPos.x);
				const ty = Math.floor(worldPos.y);
				const playerOnTile = Math.floor(ball.x) === tx && Math.floor(ball.y) === ty;
				const dist = Math.sqrt(Math.pow(tx - Math.floor(ball.x), 2) + Math.pow(ty - Math.floor(ball.y), 2));
				const isValid = tx >= 0 && tx < mapW && ty >= 0 && ty < mapH && !playerOnTile && dist <= 2;

				if (isValid) {
					dragImageElement.style.filter = "brightness(1.5)";
				} else {
					dragImageElement.style.filter = "sepia(1) hue-rotate(-50deg) saturate(5)";
				}
			}
		}
	});

	window.addEventListener("mousemove", (e) => {
		// --- Logica voor verplaatsen BINNEN container ---
		if (isRearrangingContainer && activeContainerItem) {
			const containerWindow = document.getElementById("containerWindow");
			const rect = containerWindow.getBoundingClientRect();

			// Check of de muis BUITEN de container komt -> Switch naar wereld-sleep
			if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
				isRearrangingContainer = false;

				// Verwijder uit container items array
				const index = openContainer.items.indexOf(activeContainerItem);
				if (index > -1) openContainer.items.splice(index, 1);
				renderContainerItems();

				// Start de wereld-sleep logica
				draggedItem = activeContainerItem;
				isItemDragging = true;
				isDraggingFromContainer = true;
				isDraggingFromInventory = false;
				isDraggingFromShop = false;
				draggedItemOriginalPos = null;

				// Maak het sleep-plaatje aan
				dragImageElement = document.createElement("img");
				dragImageElement.src = draggedItem.image.src;
				dragImageElement.style.position = "absolute";
				dragImageElement.style.pointerEvents = "none";
				dragImageElement.style.zIndex = "9999";
				dragImageElement.style.imageRendering = "pixelated";
				const w = (draggedItem.image.width || 64) * scale;
				const h = (draggedItem.image.height || 64) * scale;
				dragImageElement.style.width = w + "px";
				dragImageElement.style.left = e.clientX - w / 2 + "px";
				dragImageElement.style.top = e.clientY - h / 2 + "px";
				document.body.appendChild(dragImageElement);

				activeContainerItem = null;
				return;
			}

			// Zolang we BINNEN de container zijn: update positie
			const contentRect = document.getElementById("containerContent").getBoundingClientRect();
			activeContainerItem.conX = e.clientX - contentRect.left - containerDragOffset.x;
			activeContainerItem.conY = e.clientY - contentRect.top - containerDragOffset.y;
			renderContainerItems();
		}
	});

	// Helper functie om te checken of een punt in een polygoon (de muur) ligt
	function isInside(x, y, vs) {
		// ray-casting algorithm
		let inside = false;
		for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
			const xi = vs[i].sx,
				yi = vs[i].sy;
			const xj = vs[j].sx,
				yj = vs[j].sy;

			const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
			if (intersect) inside = !inside;
		}
		return inside;
	}

	// NIEUW: Functie om item daadwerkelijk op te pakken (uitgesplitst voor vertraging)
	function performItemPickup(item, clientX, clientY) {
		// Check of item nog bestaat (kan verwijderd zijn door sync)
		const index = items.indexOf(item);
		if (index === -1) return;

		// Sla de staat van de vensters op
		windowStatesBeforeDrag = {
			chat: document.getElementById("chatLog").style.display,
			inventory: document.getElementById("inventory").style.display,
			vicinity: document.getElementById("vicinityWindow").style.display,
			pouch: document.getElementById("pouchWindow").style.display,
			build: document.getElementById("buildMenu").style.display,
			shop: document.getElementById("shopWindow").style.display,
			container: document.getElementById("containerWindow").style.display,
			paper: document.getElementById("paperWindow").style.display,
			newProject: document.getElementById("newProjectWindow").style.display,
		};
		closeAllWindows(); // Sluit andere vensters

		// Start de sleep-modus voor het item
		draggedItem = items.splice(index, 1)[0];
		draggedItemOriginalPos = { x: draggedItem.x, y: draggedItem.y };
		isItemDragging = true;
		syncItems(); // DIRECT SYNCEN: Vertel server dat item weg is uit de wereld
		isDraggingFromInventory = false; // Komt uit de wereld
		isDraggingFromShop = false;
		isDraggingFromVicinity = false;
		isDraggingFromContainer = false;
		camSmooth = false;

		// Maak een tijdelijk DOM-element aan dat de muis volgt
		dragImageElement = document.createElement("img");
		dragImageElement.src = draggedItem.image.src;
		dragImageElement.style.position = "absolute";
		dragImageElement.style.pointerEvents = "none"; // Zodat we erdoorheen kunnen klikken/hoveren
		dragImageElement.style.zIndex = "9999"; // Boven alles
		dragImageElement.style.imageRendering = "pixelated";
		const w = (draggedItem.image.width || 64) * scale;
		const h = (draggedItem.image.height || 64) * scale;
		dragImageElement.style.width = w + "px";
		dragImageElement.style.left = clientX - w / 2 + "px";
		dragImageElement.style.top = clientY - h / 2 + "px";
		document.body.appendChild(dragImageElement);

		// Open de inventaris zodat de gebruiker de optie heeft om het item daarheen te slepen
		inventory.style.display = "flex";
		document.querySelector("#inventoryBtn img").src = "icons/inventory_active.png";
		renderInventoryItems();
		console.log("Item vastgepakt!", draggedItem);

		// Reset pending state
		pendingPickup = null;
		if (pickupTimer) {
			clearTimeout(pickupTimer);
			pickupTimer = null;
		}
	}

	canvas.addEventListener("mousedown", (e) => {
		e.preventDefault(); // Voorkom dat de browser de canvas als afbeelding probeert te slepen (ghost image)

		// NIEUW: Check of we op een interactie-knop klikken (zoals het batje)
		if (activeInteractionButton && e.button === 0) {
			const mx = e.clientX;
			const my = e.clientY;
			if (
				mx >= activeInteractionButton.x &&
				mx <= activeInteractionButton.x + activeInteractionButton.w &&
				my >= activeInteractionButton.y &&
				my <= activeInteractionButton.y + activeInteractionButton.h
			) {
				const obj = activeInteractionButton.obj;
				const isPong = obj.interactionType === "pong" || obj.name === "Pong";
				const isShop = obj.subCategory === "shop" || obj.name === "Winkel";
				const isContainer = obj.subCategory === "containers" || obj.name.includes("Container");
				const isTrash = obj.subCategory === "trash" || obj.name.includes("Prullenbak");
				const isTap = obj.interactionType === "tap";

				if (isPong) {
					// Check of speler een batje heeft
					const hasPaddle = inventoryItems.some((item) => item.name && item.name.toLowerCase().includes("batje"));
					if (hasPaddle) {
						// Vraag server om game te starten (AI of PvP check)
						socket.emit("requestPong", {
							tableX: obj.x,
							tableY: obj.y,
							playerX: Math.floor(ball.x),
							playerY: Math.floor(ball.y),
						});
					} else {
						showNotification("Om te kunnen tafeltennissen moet je een batje in je inventaris hebben!");
					}
				} else if (isTap) {
					const emptyBottle = inventoryItems.find((i) => i.type === "bottle_empty");
					const halfBottle = inventoryItems.find((i) => i.type === "bottle_half");

					if (emptyBottle) {
						fillBottle(emptyBottle);
					} else if (halfBottle) {
						fillBottle(halfBottle);
					} else {
						const fullBottles = inventoryItems.filter((i) => i.type === "bottle_full");
						if (fullBottles.length === 1) {
							showNotification("Fles is al gevuld!");
						} else if (fullBottles.length > 1) {
							showNotification("Flessen zijn al gevuld!");
						} else {
							showNotification("Geen flessen in inventaris!");
						}
					}
				} else if (isShop) {
					openShopWindow(obj);
				} else if (isContainer || isTrash) {
					openContainerWindow(obj);
				}
				return;
			}
		}

		// NIEUW: Tekenen op muren (Klik = Stip)
		const hasActiveMarker = isMarkerMode;
		if (hasActiveMarker && !isBuildMode && e.button === 0) {
			const mWorldX = (e.clientX - (window.innerWidth / 2 + camX)) / scale;
			const mWorldY = (e.clientY - (window.innerHeight / 4 + camY)) / scale;

			let targetWall = objects
				.slice()
				.reverse()
				.find((o) => o.isWall && isMouseOverWall(o, mWorldX, mWorldY));
			if (!targetWall) {
				for (let x = 0; x < mapW; x++) {
					const wallObj = { isWall: true, x: x, y: 0, flipped: false, wallHeight: globalWallHeight, wallThickness: globalWallThickness };
					if (isMouseOverWall(wallObj, mWorldX, mWorldY)) {
						targetWall = wallObj;
						break;
					}
				}
			}
			if (!targetWall) {
				for (let y = 0; y < mapH; y++) {
					const wallObj = { isWall: true, x: 0, y: y, flipped: true, wallHeight: globalWallHeight, wallThickness: globalWallThickness };
					if (isMouseOverWall(wallObj, mWorldX, mWorldY)) {
						targetWall = wallObj;
						break;
					}
				}
			}

			if (targetWall) {
				let wallX, wallY, wallZ;
				if (targetWall.flipped) {
					const wx = targetWall.x;
					const yOnWall = wx - mWorldX / 32;
					const zOnWall = (wx + yOnWall) * 16 - mWorldY;
					wallX = wx;
					wallY = yOnWall;
					wallZ = zOnWall;
				} else {
					const wy = targetWall.y;
					const xOnWall = mWorldX / 32 + wy;
					const zOnWall = (xOnWall + wy) * 16 - mWorldY;
					wallX = xOnWall;
					wallY = wy;
					wallZ = zOnWall;
				}

				if (markerTool === "draw") {
					const markId = Date.now() + "-" + Math.random().toString(36).substr(2, 9);
					const mark = {
						x: wallX,
						y: wallY,
						z: wallZ,
						life: 1.0,
						decayRate: 0,
						sortOffset: 0.05,
						color: markerColor,
						size: markerSize,
						id: markId,
					};
					currentStroke.push(mark); // Start nieuwe stroke
					activeMarks.push(mark);
					if (socket) socket.emit("placeMarks", [mark]);
					lastMarkerPos = { x: wallX, y: wallY, z: wallZ };
				} else if (markerTool === "erase") {
					let eSize = markerSize;
					if (eSize === 6) eSize = 10;
					const eraseRadius = eSize * 0.1;
					const r2 = eraseRadius * eraseRadius;

					const initialLength = activeMarks.length;
					activeMarks = activeMarks.filter((m) => {
						const dx = m.x - wallX;
						const dy = m.y - wallY;
						const dz = m.z - wallZ;
						return dx * dx + dy * dy + dz * dz > r2;
					});

					if (activeMarks.length !== initialLength) {
						if (socket) socket.emit("removeMarks", { x: wallX, y: wallY, z: wallZ, radius: eraseRadius });
					}
					lastMarkerPos = null;
				}
				return; // Stop verdere events (geen drag/move)
			}
		}

		if (e.button === 0) {
			// Linkermuisknop
			// --- Logica voor verslepen van 'moveable' objecten (buiten bouwmodus) ---
			if (!isBuildMode) {
				const { x, y } = toTile(e.clientX, e.clientY);
				const objectToDragIndex = objects.findIndex((o) => {
					const w = o.flipped ? o.depth || 1 : o.width || 1;
					const d = o.flipped ? o.width || 1 : o.depth || 1;
					return x >= o.x && x < o.x + w && y >= o.y && y < o.y + d && o.moveable;
				});

				if (objectToDragIndex > -1) {
					// Sla de staat van de vensters op VOORDAT ze gesloten worden
					windowStatesBeforeDrag = {
						chat: document.getElementById("chatLog").style.display,
						inventory: document.getElementById("inventory").style.display,
						vicinity: document.getElementById("vicinityWindow").style.display,
						pouch: document.getElementById("pouchWindow").style.display,
						build: document.getElementById("buildMenu").style.display,
						shop: document.getElementById("shopWindow").style.display,
						marker: document.getElementById("markerMenu").style.display,
						container: document.getElementById("containerWindow").style.display,
						paper: document.getElementById("paperWindow").style.display,
						newProject: document.getElementById("newProjectWindow").style.display,
					};
					closeAllWindows(); // Sluit alle vensters bij het oppakken van een object
					draggedObject = objects.splice(objectToDragIndex, 1)[0];
					socket.emit("removeObject", {
						id: draggedObject.id,
						x: draggedObject.x,
						y: draggedObject.y,
						name: draggedObject.name,
					});
					draggedObjectOriginalPos = { x: draggedObject.x, y: draggedObject.y };
					camOriginalPos = { x: camX, y: camY }; // Sla de huidige camera positie op
					isObjectDragging = true; // Start de sleep-modus voor het object
					camSmooth = false; // Stop eventuele smooth-beweging
					return;
				}

				// --- Logica voor het oppakken van items ---
				const itemToPickIndex = items.findIndex((item) => {
					const itemTileX = Math.floor(item.x);
					const itemTileY = Math.floor(item.y);
					return itemTileX === x && itemTileY === y;
				});

				if (itemToPickIndex > -1) {
					const itemToPick = items[itemToPickIndex];
					const playerTileX = Math.floor(ball.x);
					const playerTileY = Math.floor(ball.y);
					const itemTileX = Math.floor(itemToPick.x);
					const itemTileY = Math.floor(itemToPick.y);

					const distance = Math.sqrt(Math.pow(playerTileX - itemTileX, 2) + Math.pow(playerTileY - itemTileY, 2));

					// Alleen oppakken als de speler dichtbij genoeg is
					if (distance <= 2) {
						// NIEUW: Start vertraagd oppakken (zodat kort klikken = lopen)
						pendingPickup = { item: itemToPick, x: e.clientX, y: e.clientY };

						// Wacht 200ms. Als muis dan nog ingedrukt is (of bewogen), pakken we hem op.
						// Als muis eerder losgelaten wordt, is het een klik (lopen).
						pickupTimer = setTimeout(() => {
							performItemPickup(itemToPick, pendingPickup ? pendingPickup.x : e.clientX, pendingPickup ? pendingPickup.y : e.clientY);
						}, 200);

						// We returnen NIET, zodat dragStart gezet wordt en mouseup de loop-logica kan triggeren als we annuleren.
					}
				}
			}
			// Sla de startpositie op voor een mogelijke klik-actie (geen drag)
			dragStart.x = e.clientX;
			dragStart.y = e.clientY;
		}
		// Sla de startpositie op voor een mogelijke klik-actie (geen drag) - Ook voor rechtermuisknop
		dragStart.x = e.clientX;
		dragStart.y = e.clientY;
		if (e.button === 2) {
			// Rechtermuisknop
			camStart.x = camX;
			camStart.y = camY;
			isCameraDragging = true; // Start camera slepen
			camSmooth = false;
		}
	});

	window.addEventListener("mouseup", (e) => {
		// Als we hier komen, was het geen object-sleep, dus het kan een klik zijn
		// of een drag die geen object betrof.
		lastMarkerPos = null;

		const dx = e.clientX - dragStart.x;
		const dy = e.clientY - dragStart.y;

		// NIEUW: Als we aan het wachten waren op een pickup, en we laten nu los (korte klik):
		// Annuleer de pickup. De code hieronder zal het interpreteren als een klik (want dx/dy is klein)
		// en de loop-logica triggeren.
		if (pickupTimer) {
			clearTimeout(pickupTimer);
			pickupTimer = null;
			pendingPickup = null;
			// We gaan nu door naar de standaard logica. Omdat isItemDragging false is,
			// en dx/dy klein is, zal de loop-logica onderaan deze functie afgaan.
		}

		// --- Afhandeling van het loslaten van een versleept item ---
		if (isItemDragging && e.button === 0) {
			// Safety check: als draggedItem om een of andere reden null is, stop dan.
			if (!draggedItem) {
				isItemDragging = false;
				return;
			}

			if (dragImageElement) {
				dragImageElement.remove();
				dragImageElement = null;
			}

			let { x, y } = toTile(e.clientX, e.clientY);
			const inventory = document.getElementById("inventory");
			const containerWindow = document.getElementById("containerWindow");
			let droppedInInventory = false;

			// Check of we over de container of pouch droppen
			const containerRect = containerWindow.getBoundingClientRect();
			const isOverContainer =
				containerWindow.style.display === "flex" &&
				openContainer &&
				e.clientX >= containerRect.left &&
				e.clientX <= containerRect.right &&
				e.clientY >= containerRect.top &&
				e.clientY <= containerRect.bottom;

			const pouchWindow = document.getElementById("pouchWindow");
			const pouchRect = pouchWindow.getBoundingClientRect();
			const isOverPouch =
				pouchWindow.style.display === "flex" &&
				openPouch &&
				e.clientX >= pouchRect.left &&
				e.clientX <= pouchRect.right &&
				e.clientY >= pouchRect.top &&
				e.clientY <= pouchRect.bottom;

			const targetContainer = isOverPouch ? openPouch : isOverContainer ? openContainer : null;

			if (targetContainer) {
				// Voorkom dat een pouch in zichzelf wordt gedropt
				if (draggedItem !== targetContainer) {
					const isCigPack = targetContainer.type === "sigaretten_container" || targetContainer.itemType === "sigaretten_container";
					let allowed = true;

					if (isCigPack) {
						if (targetContainer.items.length >= 20) {
							showNotification("Pakje is vol!");
							allowed = false;
						} else if (
							draggedItem.type !== "sigaret" &&
							draggedItem.itemType !== "sigaret" &&
							draggedItem.type !== "sigaret_half" &&
							draggedItem.itemType !== "sigaret_half"
						) {
							showNotification("Alleen voor sigaretten!");
							allowed = false;
						}
					}

					if (allowed) {
						const contentEl = isOverPouch ? document.getElementById("pouchContent") : document.getElementById("containerContent");
						const contentRect = contentEl.getBoundingClientRect();
						draggedItem.conX = e.clientX - contentRect.left - 50;
						draggedItem.conY = e.clientY - contentRect.top - 50;
						targetContainer.items.push(draggedItem);

						if (isOverPouch) {
							renderPouchItems();
							savePlayerData(); // Pouches zijn onderdeel van spelerdata
						} else {
							renderContainerItems();
						}
						droppedInInventory = true; // Set this to prevent it from being placed in the world
					} else {
						// NIEUW: Als het item geweigerd wordt, stuur het terug naar de bron
						if (isDraggingFromInventory) {
							inventoryItems.push(draggedItem);
							savePlayerData();
							renderInventoryItems();
						} else if (isDraggingFromShop) {
							shopOutputItems.push(draggedItem);
							renderShopOutput();
						} else if (isDraggingFromContainer && openPouch) {
							openPouch.items.push(draggedItem);
							renderPouchItems();
						} else if (isDraggingFromContainer && openContainer) {
							openContainer.items.push(draggedItem);
							renderContainerItems();
						} else if (isDraggingFromVicinity) {
							// Terug naar wereld (vicinity)
							draggedItem.x = draggedItemOriginalPos.x;
							draggedItem.y = draggedItemOriginalPos.y;
							items.push(draggedItem);
							syncItems();
						} else {
							draggedItem.x = draggedItemOriginalPos.x;
							draggedItem.y = draggedItemOriginalPos.y;
							items.push(draggedItem);
							syncItems();
						}
						droppedInInventory = true; // Voorkom dat het in de wereld of inventory (via overlap) belandt
					}
				}
			}

			if (inventory && inventory.style.display === "flex") {
				const inventoryRect = inventory.getBoundingClientRect();
				const isOverInventory =
					e.clientX >= inventoryRect.left &&
					e.clientX <= inventoryRect.right &&
					e.clientY >= inventoryRect.top &&
					e.clientY <= inventoryRect.bottom;

				if (isOverInventory && !droppedInInventory) {
					// NIEUW: Check eigenaarschap bij opslaan in inventaris
					if (draggedItem.ownerId && draggedItem.ownerId !== myUserId) {
						let ownerName = "een andere speler";
						if (otherPlayers[draggedItem.ownerId]) ownerName = otherPlayers[draggedItem.ownerId].name;
						showNotification(`${draggedItem.name} is eigendom van ${ownerName}!`, "icons/verboden.png");
						// We zetten droppedInInventory NIET op true, zodat de code hieronder
						// het item terug in de wereld probeert te plaatsen (wat mag volgens de regels).
					} else {
						if (draggedItem.type === "currency" || draggedItem.type === "currency_big") {
							let amount = 0;
							if (draggedItem.type === "currency") {
								// Random bedrag tussen 0.05 en 20.00 in stappen van 0.05
								const steps = Math.floor(Math.random() * 400) + 1; // 1 tot 400
								amount = steps * 0.05;
							} else {
								// Random bedrag tussen 25.00 en 100.00 in stappen van 0.05
								const steps = Math.floor(Math.random() * 1501); // 0 tot 1500 (75 / 0.05)
								amount = 25 + steps * 0.05;
							}

							addToWallet(amount);
							console.log("Geld toegevoegd:", amount.toFixed(2));
						} else {
							// Bereken positie in inventaris op basis van muis
							const contentRect = document.getElementById("inventoryContent").getBoundingClientRect();
							draggedItem.invX = e.clientX - contentRect.left - 50; // Centreer op muis (100/2)
							draggedItem.invY = e.clientY - contentRect.top - 50;

							inventoryItems.push(draggedItem);
							savePlayerData(); // Opslaan (item erbij)
							renderInventoryItems();
							console.log("Item in inventaris geplaatst:", draggedItem);
						}
						droppedInInventory = true;
					}
				}
			}

			if (!droppedInInventory) {
				const playerOnTile = Math.floor(ball.x) === x && Math.floor(ball.y) === y;

				// Check afstand (max 2 tegels)
				const dist = Math.sqrt(Math.pow(x - Math.floor(ball.x), 2) + Math.pow(y - Math.floor(ball.y), 2));
				// NIEUW: Items mogen op objecten en op elkaar
				let isValidPlacement = x >= 0 && x < mapW && y >= 0 && y < mapH && !playerOnTile && dist <= 2;

				// NIEUW: Auto-drop naast speler als plek ongeldig is (bijv. te ver weg)
				if (!isValidPlacement) {
					const px = Math.floor(ball.x);
					const py = Math.floor(ball.y);
					const offsets = [
						{ dx: 1, dy: 0 },
						{ dx: -1, dy: 0 },
						{ dx: 0, dy: 1 },
						{ dx: 0, dy: -1 },
						{ dx: 1, dy: 1 },
						{ dx: 1, dy: -1 },
						{ dx: -1, dy: 1 },
						{ dx: -1, dy: -1 },
					];

					for (const o of offsets) {
						const tx = px + o.dx;
						const ty = py + o.dy;
						// Check of deze buur-tegel geldig is (binnen map, niet op speler)
						if (tx >= 0 && tx < mapW && ty >= 0 && ty < mapH && !(tx === px && ty === py)) {
							x = tx;
							y = ty;
							isValidPlacement = true;
							break;
						}
					}
				}

				if (isValidPlacement) {
					const surfaceZ = getSurfaceHeight(x, y);
					draggedItem.x = x + 0.5 + (Math.random() * 0.6 - 0.3); // Iets meer random
					draggedItem.y = y + 0.5 + (Math.random() * 0.6 - 0.3); // Iets meer random

					// BONUS: Laat het item stuiteren bij plaatsen (vanaf iets boven het oppervlak)
					draggedItem.z = surfaceZ + 2; // AANGEPAST: Bijna direct op de grond (was +10)
					draggedItem.vz = 0; // Start snelheid
					draggedItem.lastTouchedBy = mySocketId; // NIEUW: Wij zijn eigenaar

					// NIEUW: Zorg dat physics variabelen bestaan (voorkomt NaN bugs waardoor items verdwijnen)
					if (draggedItem.vx === undefined) draggedItem.vx = 0;
					if (draggedItem.vy === undefined) draggedItem.vy = 0;
					if (draggedItem.vr === undefined) draggedItem.vr = 0;
					if (draggedItem.rotation === undefined) draggedItem.rotation = 0;

					if (socket) {
						socket.emit("placeItem", serializeItem(draggedItem));
					} else {
						items.push(draggedItem); // Fallback voor single player
					}
				} else {
					// Als de plaatsing ongeldig is:
					if (isDraggingFromInventory) {
						// Terug naar inventaris als het daar vandaan kwam
						inventoryItems.push(draggedItem);
						savePlayerData(); // Opslaan
						renderInventoryItems();
					} else if (isDraggingFromShop) {
						// Terug naar winkel uitgifte
						shopOutputItems.push(draggedItem);
						renderShopOutput();
					} else if (isDraggingFromContainer && openPouch) {
						// BUG FIX: Was renderShopOutput()
						// Terug naar pouch
						openPouch.items.push(draggedItem);
						renderPouchItems();
					} else if (isDraggingFromContainer && openContainer) {
						// Terug naar container
						openContainer.items.push(draggedItem);
						renderContainerItems();
					} else if (isDraggingFromVicinity) {
						// Terug naar wereld
						draggedItem.x = draggedItemOriginalPos.x;
						draggedItem.y = draggedItemOriginalPos.y;
						items.push(draggedItem);
						syncItems();
					} else {
						// Terug naar oude plek in de wereld
						draggedItem.x = draggedItemOriginalPos.x;
						draggedItem.y = draggedItemOriginalPos.y;
						items.push(draggedItem);
						syncItems();
					}
					console.log("Ongeldige plaatsing, item teruggezet.");
				}
			}

			// Reset alle sleep-gerelateerde variabelen voor items
			isItemDragging = false;
			isDraggingFromInventory = false;
			isDraggingFromShop = false;
			isDraggingFromVicinity = false;
			isDraggingFromContainer = false;
			draggedItem = null;
			draggedItemOriginalPos = null;

			// Heropen de vensters die open stonden
			if (windowStatesBeforeDrag) {
				if (windowStatesBeforeDrag.chat) document.getElementById("chatLog").style.display = windowStatesBeforeDrag.chat;
				// We laten de inventory open als die al open was, of als we er iets in hebben gesleept.
				if (windowStatesBeforeDrag.inventory === "flex" || droppedInInventory) {
					if (inventory) {
						inventory.style.display = "flex";
						document.querySelector("#inventoryBtn img").src = "icons/inventory_active.png";
					}
				} else {
					if (inventory) {
						inventory.style.display = "none";
						document.querySelector("#inventoryBtn img").src = "icons/inventory.png";
					}
				}
				if (windowStatesBeforeDrag.vicinity === "flex") {
					document.getElementById("vicinityWindow").style.display = "flex";
				}
				if (windowStatesBeforeDrag.pouch === "flex") {
					document.getElementById("pouchWindow").style.display = "flex";
				}
				if (windowStatesBeforeDrag.build === "flex") {
					if (!isBuildMode) buildBtn.click();
				}
				if (windowStatesBeforeDrag.shop === "flex") {
					document.getElementById("shopWindow").style.display = "flex";
				}
				if (windowStatesBeforeDrag.marker === "flex") document.getElementById("markerMenu").style.display = "flex";
				if (windowStatesBeforeDrag.container === "flex") {
					document.getElementById("containerWindow").style.display = "flex";
				}
				if (windowStatesBeforeDrag.paper === "flex") {
					document.getElementById("paperWindow").style.display = "flex";
				}
				if (windowStatesBeforeDrag.newProject === "flex") {
					document.getElementById("newProjectWindow").style.display = "flex";
				}
				windowStatesBeforeDrag = null;
			}
			return; // Belangrijk: stop verdere uitvoering
		}

		// Stop met herschikken in inventaris (en handel drop af)
		if (isRearrangingInventory) {
			const inventory = document.getElementById("inventory");
			const containerWindow = document.getElementById("containerWindow");

			const pouchWindow = document.getElementById("pouchWindow");
			// Check of we het op de container hebben gedropt
			let droppedInContainer = false;
			if (containerWindow && containerWindow.style.display === "flex" && openContainer && activeInventoryItem) {
				const cRect = containerWindow.getBoundingClientRect();
				if (e.clientX >= cRect.left && e.clientX <= cRect.right && e.clientY >= cRect.top && e.clientY <= cRect.bottom) {
					// Ja, gedropt op container.

					// Voorkom dat een pouch in zichzelf wordt gedropt
					if (activeInventoryItem !== openContainer) {
						const isCigPack = openContainer.type === "sigaretten_container" || openContainer.itemType === "sigaretten_container";
						let allowed = true;

						if (isCigPack) {
							if (openContainer.items.length >= 20) {
								showNotification("Pakje is vol!");
								allowed = false;
							} else if (
								activeInventoryItem.type !== "sigaret" &&
								activeInventoryItem.itemType !== "sigaret" &&
								activeInventoryItem.type !== "sigaret_half" &&
								activeInventoryItem.itemType !== "sigaret_half"
							) {
								showNotification("Alleen voor sigaretten!");
								allowed = false;
							}
						}

						if (allowed) {
							const contentRect = document.getElementById("containerContent").getBoundingClientRect();
							activeInventoryItem.conX = e.clientX - contentRect.left - 50;
							activeInventoryItem.conY = e.clientY - contentRect.top - 50;
							openContainer.items.push(activeInventoryItem);

							// Verwijder uit inventory om duplicatie te voorkomen
							const idx = inventoryItems.indexOf(activeInventoryItem);
							if (idx > -1) inventoryItems.splice(idx, 1);
							renderInventoryItems();

							renderContainerItems();
							if (openContainer.isPouch || openContainer.type === "pouch") {
								savePlayerData();
							}
							droppedInContainer = true;
						}
					}
				}
			} else if (pouchWindow && pouchWindow.style.display === "flex" && openPouch && activeInventoryItem) {
				const pRect = pouchWindow.getBoundingClientRect();
				if (e.clientX >= pRect.left && e.clientX <= pRect.right && e.clientY >= pRect.top && e.clientY <= pRect.bottom) {
					// Ja, gedropt op pouch.
					if (activeInventoryItem !== openPouch) {
						const isCigPack = openPouch.type === "sigaretten_container" || openPouch.itemType === "sigaretten_container";
						let allowed = true;

						if (isCigPack) {
							if (openPouch.items.length >= 20) {
								showNotification("Pakje is vol!");
								allowed = false;
							} else if (
								activeInventoryItem.type !== "sigaret" &&
								activeInventoryItem.itemType !== "sigaret" &&
								activeInventoryItem.type !== "sigaret_half" &&
								activeInventoryItem.itemType !== "sigaret_half"
							) {
								showNotification("Alleen voor sigaretten!");
								allowed = false;
							}
						}

						if (allowed) {
							const contentRect = document.getElementById("pouchContent").getBoundingClientRect();
							activeInventoryItem.conX = e.clientX - contentRect.left - 50;
							activeInventoryItem.conY = e.clientY - contentRect.top - 50;
							openPouch.items.push(activeInventoryItem);

							// Verwijder uit inventory om duplicatie te voorkomen
							const idx = inventoryItems.indexOf(activeInventoryItem);
							if (idx > -1) inventoryItems.splice(idx, 1);
							renderInventoryItems();

							renderPouchItems();
							savePlayerData();
							droppedInContainer = true;
						}
					}
				}
			}

			savePlayerData(); // Sla altijd op, of het nu verplaatst is in inv of naar container
			isRearrangingInventory = false;
			activeInventoryItem = null;
			activeInventoryDiv = null;
			return; // Stop verdere muis-afhandeling
		}

		if (isRearrangingContainer) {
			isRearrangingContainer = false;
			activeContainerItem = null;
		}

		if (activePouchItem) {
			isRearrangingContainer = false; // Hergebruik vlag
			activePouchItem = null;
		}

		// Voor de volgende acties (bouwen, lopen) moet de muis op het canvas zijn
		if (e.target !== canvas) return;

		// Als we in bouwmodus zijn en het een klik was, handel de tool-actie af
		if (e.button === 0 && isBuildMode && Math.sqrt(dx * dx + dy * dy) < 5) {
			// Alleen uitvoeren bij linkermuisknop
			const { x, y } = toTile(e.clientX, e.clientY);

			// NIEUW: Specifieke coördinaten voor muren (snap to line)
			let placeX = x;
			let placeY = y;
			if (buildTool === "place_wall" || (selectedBuildObject && selectedBuildObject.placement === "wall_structure")) {
				const worldPos = toWorld(e.clientX, e.clientY);
				const wx = worldPos.x;
				const wy = worldPos.y;

				if (isBuildObjectFlipped) {
					placeX = Math.round(wx);
					placeY = Math.floor(wy);
				} else {
					placeX = Math.floor(wx);
					placeY = Math.round(wy);
				}
			}

			// Plaatsen kan op een tegel (x/y >= 0) of op een muur (hoverTarget.type === 'wall')
			if (
				(activeBuildCategory === "objecten" || activeBuildCategory === "wallbuild") &&
				((x >= 0 && y >= 0) || hoverTarget?.type === "wall")
			) {
				// NIEUW: Ondersteuning voor meerdere muursegmenten (width)
				const wallWidth = (selectedBuildObject && selectedBuildObject.placement === "wall_structure" && selectedBuildObject.width) || 1;
				let allSegmentsValid = true;

				if (buildTool === "place_wall" || (selectedBuildObject && selectedBuildObject.placement === "wall_structure")) {
					for (let i = 0; i < wallWidth; i++) {
						let segX = placeX;
						let segY = placeY;
						if (isBuildObjectFlipped) segY += i;
						else segX += i;

						const valid = isBuildObjectFlipped
							? segX > 0 && segX <= mapW && segY >= 0 && segY < mapH
							: segX >= 0 && segX < mapW && segY > 0 && segY <= mapH;

						if (!valid || isWallAt(segX, segY, isBuildObjectFlipped)) {
							allSegmentsValid = false;
							break;
						}
					}
				}

				if (
					(buildTool === "place_wall" || (selectedBuildObject && selectedBuildObject.placement === "wall_structure")) &&
					allSegmentsValid
				) {
					// Check geld voor muren
					if (selectedBuildObject && selectedBuildObject.price && !isUserAdmin) {
						if (walletBalance < selectedBuildObject.price) {
							showNotification(`Niet genoeg geld! Nodig: €${selectedBuildObject.price}`);
							return;
						}
						addToWallet(-selectedBuildObject.price);
						showNotification(`<span style="color: #f44336;">-€${selectedBuildObject.price.toFixed(2).replace(".", ",")}</span>`);
					}

					// NIEUW: Genereer groupId voor gekoppelde muren
					const groupId = Date.now().toString(36) + Math.random().toString(36).substr(2);

					// Plaats muur (of muren)
					for (let i = 0; i < wallWidth; i++) {
						let segX = placeX;
						let segY = placeY;
						if (isBuildObjectFlipped) segY += i;
						else segX += i;

						// Als het een muur van 3 breed is, is de middelste (index 1) een poort
						const isGate = wallWidth === 3 && i === 1;

						const newWall = {
							isWall: true,
							name: "Muur",
							groupId: groupId, // NIEUW: Koppel muren aan elkaar
							isGate: isGate, // NIEUW: Markeer als poort
							x: segX,
							y: segY,
							wallHeight: selectedBuildObject ? selectedBuildObject.wallHeight || 150 : globalWallHeight,
							wallThickness: selectedBuildObject ? selectedBuildObject.wallThickness || 0.25 : globalWallThickness,
							flipped: isBuildObjectFlipped,
							color: isBuildObjectFlipped ? "#666" : "#555", // Match bestaande muren (Left vs Top)
							ownerId: mySocketId,
							price: (selectedBuildObject ? selectedBuildObject.price : 0) / wallWidth, // Prijs per segment
						};
						socket.emit("placeObject", newWall);
					}
					return;
				}

				// Check geld voor spelers
				if (!isUserAdmin && buildTool === "place" && selectedBuildObject && selectedBuildObject.price) {
					if (walletBalance < selectedBuildObject.price) {
						showNotification(`Niet genoeg geld! Nodig: €${selectedBuildObject.price}`);
						return;
					}
					// Geld wordt afgeschreven als plaatsing succesvol is (hieronder)
				}

				// --- Object Tool Logica ---
				switch (buildTool) {
					case "place":
						// NIEUW: Check voor Item Spawns
						if (selectedBuildObject?.isItem) {
							// Items negeren object-collision (mogen erop) en item-collision (mogen op elkaar)
							if (hoverTarget?.type !== "wall" && x >= 0 && x < mapW && y >= 0 && y < mapH) {
								if (!isUserAdmin && selectedBuildObject.price) {
									addToWallet(-selectedBuildObject.price);
									showNotification(`<span style="color: #f44336;">-€${selectedBuildObject.price.toFixed(2).replace(".", ",")}</span>`);
								}
								const surfaceZ = getSurfaceHeight(x, y);
								const newItem = {
									type: selectedBuildObject.itemType,
									name: selectedBuildObject.name,
									x: x + 0.5 + (Math.random() * 0.6 - 0.3), // Iets meer random
									y: y + 0.5 + (Math.random() * 0.6 - 0.3), // Iets meer random
									z: surfaceZ + 50, // Spawn uit de lucht boven het oppervlak
									vx: 0,
									vy: 0,
									vz: 0,
									rotation: 0,
									vr: 0,
									mass: selectedBuildObject.mass || 1.0,
									canRotate: selectedBuildObject.canRotate || false,
									canTopple: selectedBuildObject.canTopple || false,
									isPouch: selectedBuildObject.isPouch || false,
									uses: selectedBuildObject.uses,
								};

								// NIEUW: Als het een pakje sigaretten is, vul het met random 0-20 sigaretten
								if (newItem.type === "sigaretten_container") {
									newItem.items = [];
									const count = Math.floor(Math.random() * 20); // 0 tot 20
									for (let i = 0; i < count; i++) {
										newItem.items.push({
											type: "sigaret",
											name: "Sigaret",
											mass: 0.05,
											canTopple: true,
											vx: 0,
											vy: 0,
											vz: 0,
											rotation: 0,
											vr: 0, // NIEUW: Physics initialiseren
										});
									}
								}

								// NIEUW: Admin random uses voor aansteker (0-50)
								if (isUserAdmin && newItem.type === "aansteker") {
									newItem.uses = Math.floor(Math.random() * 51);
								}

								socket.emit("placeItem", newItem);
							}
						} else if (selectedBuildObject?.placement === "floor" && selectedBuildObject.name) {
							if (hoverTarget?.type !== "wall" && checkPlacement(x, y, selectedBuildObject, isBuildObjectFlipped)) {
								if (!isUserAdmin && selectedBuildObject.price) {
									addToWallet(-selectedBuildObject.price);
									showNotification(`<span style="color: #f44336;">-€${selectedBuildObject.price.toFixed(2).replace(".", ",")}</span>`);
								}
								const { runtimeImage, ...objectToSend } = selectedBuildObject;
								socket.emit("placeObject", { ...objectToSend, x: x, y: y, flipped: isBuildObjectFlipped, ownerId: mySocketId });
							}
						} else if (selectedBuildObject?.placement === "wall" && hoverTarget?.type === "wall") {
							const wallId = hoverTarget.id; // De ID van de muur waar we op klikken

							if (selectedBuildObject.isFree) {
								// NIEUW: Vrije plaatsing
								const mouseWorldX = (e.clientX - (window.innerWidth / 2 + camX)) / scale;
								const mouseWorldY = (e.clientY - (window.innerHeight / 4 + camY)) / scale;
								const wallSide = wallId.split("_")[0];

								if (!isUserAdmin && selectedBuildObject.price) {
									addToWallet(-selectedBuildObject.price);
									showNotification(`<span style="color: #f44336;">-€${selectedBuildObject.price.toFixed(2).replace(".", ",")}</span>`);
								}
								socket.emit("placeWallObject", {
									wallId: wallId,
									name: selectedBuildObject.name,
									flipped: isBuildObjectFlipped,
									image: selectedBuildObject.image,
									isCustom: selectedBuildObject.isCustom,
									ownerId: mySocketId,
									isFree: true,
									freeX: mouseWorldX,
									freeY: mouseWorldY,
									wallSide: wallSide,
									isTemplate: true, // Markeer dat dit van een template komt
									width: selectedBuildObject.width || 1,
								});
							} else {
								// OUDE LOGICA voor grid-based
								const width = selectedBuildObject.width || 1;
								const [type, indexStr] = wallId.split("_");
								const startIndex = parseInt(indexStr);
								let isValid = true;
								for (let i = 0; i < width; i++) {
									const currentWallId = `${type}_${startIndex + i}`;
									const max = type === "top" ? mapW : mapH;
									if (startIndex + i >= max) {
										isValid = false;
										break;
									}
								}

								if (!isValid) {
									showNotification("Niet genoeg ruimte voor dit object!");
									return;
								}

								if (!isUserAdmin && selectedBuildObject.price) {
									addToWallet(-selectedBuildObject.price);
									showNotification(`<span style="color: #f44336;">-€${selectedBuildObject.price.toFixed(2).replace(".", ",")}</span>`);
								}
								socket.emit("placeWallObject", {
									wallId: wallId,
									name: selectedBuildObject.name,
									flipped: isBuildObjectFlipped,
									image: selectedBuildObject.image, // Stuur plaatje mee
									isCustom: selectedBuildObject.isCustom, // Stuur custom vlag mee
									ownerId: mySocketId, // Stuur eigenaar mee
									width: width, // Stuur breedte mee
									xOffset: selectedBuildObject.xOffset, // NIEUW: Stuur offsets mee
									yOffset: selectedBuildObject.yOffset,
								});
							}
						}
						break;
					case "move":
						if (movingObject) {
							let isValid = false;
							if (movingObject.isItem) {
								isValid = hoverTarget?.type !== "wall" && x >= 0 && x < mapW && y >= 0 && y < mapH;
							} else if (movingObject.wallId) {
								// Het is een muurobject
								isValid = hoverTarget && hoverTarget.type === "wall";
								if (!movingObject.isFree && isValid) {
									const wallId = hoverTarget.id;
									const width = movingObject.width || 1;
									const [type, indexStr] = wallId.split("_");
									const startIndex = parseInt(indexStr);

									let placementValid = true;
									for (let i = 0; i < width; i++) {
										const currentWallId = `${type}_${startIndex + i}`;
										const max = type === "top" ? mapW : mapH;
										if (startIndex + i >= max) {
											placementValid = false;
											break;
										}
									}
									isValid = placementValid;
								}
							} else {
								isValid = hoverTarget?.type !== "wall" && checkPlacement(x, y, movingObject, movingObject.flipped);
							}

							if (isValid) {
								if (movingObject.isItem) {
									movingObject.x = x;
									movingObject.y = y;
									movingObject.x += 0.5; // Centreer item op tegel
									movingObject.y += 0.5;

									// Reset physics state (idle)
									movingObject.rotation = 0;
									movingObject.vr = 0;
									movingObject.vx = 0;
									movingObject.vy = 0;
									movingObject.vz = 0;
									movingObject.z = getSurfaceHeight(x, y);

									const { image, isItem, ...itemToSend } = movingObject;
									socket.emit("placeItem", itemToSend);
								} else if (movingObject.wallId) {
									// Het is een muurobject
									if (movingObject.isFree) {
										// NIEUW: Vrije plaatsing
										const mouseWorldX = (e.clientX - (window.innerWidth / 2 + camX)) / scale;
										const mouseWorldY = (e.clientY - (window.innerHeight / 4 + camY)) / scale;
										const wallSide = hoverTarget.id.split("_")[0];
										socket.emit("placeWallObject", {
											wallId: hoverTarget.id,
											name: movingObject.name,
											flipped: movingObject.flipped,
											image: movingObject.image,
											isCustom: movingObject.isCustom,
											ownerId: mySocketId,
											isFree: true,
											freeX: mouseWorldX,
											freeY: mouseWorldY,
											wallSide: wallSide,
											width: movingObject.width || 1,
										});
									} else {
										// OUDE LOGICA
										socket.emit("placeWallObject", {
											wallId: hoverTarget.id,
											name: movingObject.name,
											flipped: movingObject.flipped,
											image: movingObject.image,
											isCustom: movingObject.isCustom,
											ownerId: mySocketId,
											width: movingObject.width || 1,
										});
									}
								} else {
									if (movingObject.isWall) {
										// Muren hebben specifieke coördinaten nodig (snap to line)
										// movingObject.x/y zijn al geupdate in mousemove, maar voor zekerheid:
										const worldPos = toWorld(e.clientX, e.clientY);
										const wx = worldPos.x;
										const wy = worldPos.y;

										if (movingObject.flipped) {
											movingObject.x = Math.round(wx);
											movingObject.y = Math.floor(wy);
										} else {
											movingObject.x = Math.floor(wx);
											movingObject.y = Math.round(wy);
										}

										// Check validiteit voor muren
										const inBounds = movingObject.flipped
											? movingObject.x > 0 && movingObject.x <= mapW && movingObject.y >= 0 && movingObject.y < mapH
											: movingObject.x >= 0 && movingObject.x < mapW && movingObject.y > 0 && movingObject.y <= mapH;
										const colliding = isWallAt(movingObject.x, movingObject.y, movingObject.flipped, movingObject);

										if (!inBounds || colliding) {
											showNotification("Ongeldige positie!");
											return;
										}

										// NIEUW: Update kleur op basis van oriëntatie bij verplaatsen
										movingObject.color = movingObject.flipped ? "#666" : "#555";
									} else {
										movingObject.x = x;
										movingObject.y = y;
									}
									const { runtimeImage, ...objectToSend } = movingObject;
									socket.emit("placeObject", objectToSend); // Stuur naar server
								}
								movingObject = null; // Stop met verplaatsen
								movePreview.style.display = "none";
								hoveredObjects = []; // Reset hovered objects om stale references te voorkomen
							}
						} else {
							// Anders, pak een object op
							let objectToMove = null;

							// Gebruik de selectie uit het menu als die er is
							if (hoveredObjects.length > 0) {
								objectToMove = hoveredObjects[moveSelectionIndex];
							}

							if (objectToMove) {
								const itemIndex = items.indexOf(objectToMove);
								if (itemIndex > -1) {
									movingObject = items.splice(itemIndex, 1)[0];
									movingObject.isItem = true; // Markeer als item
									socket.emit("removeItem", {
										x: Math.floor(movingObject.x),
										y: Math.floor(movingObject.y),
										type: movingObject.type,
										name: movingObject.name,
									});
									closeSecondaryWindows();
								} else if (objectToMove.wallId) {
									// Muurobject oppakken
									const idx = wallObjects.indexOf(objectToMove);
									if (idx > -1) {
										movingObject = objectToMove;
										wallObjects.splice(idx, 1); // Verwijder direct uit lokale lijst

										isBuildObjectFlipped = movingObject.flipped; // Synchroniseer de rotatie-status
										socket.emit("removeWallObject", {
											id: movingObject.id,
											wallId: movingObject.wallId,
											name: movingObject.name,
											ownerId: movingObject.ownerId,
											isCustom: movingObject.isCustom,
											image: movingObject.image,
										});
										closeSecondaryWindows();
									}
								} else {
									const objectToMoveIndex = objects.indexOf(objectToMove);
									if (objectToMoveIndex > -1) {
										movingObject = objects.splice(objectToMoveIndex, 1)[0];
										// Maak een schoon object zonder runtime properties voor de server
										const { runtimeImage, ...objectToSend } = movingObject;
										socket.emit("removeObject", objectToSend);
										closeSecondaryWindows(); // Sluit andere vensters bij het oppakken
										isBuildObjectFlipped = movingObject.flipped; // Synchroniseer de rotatie-status
									}
								}
							}
						}
						break;
					case "delete":
						let objectToDelete = null;

						// Gebruik de selectie uit het menu als die er is
						if (hoveredObjects.length > 0) {
							objectToDelete = hoveredObjects[moveSelectionIndex];
						}

						if (objectToDelete) {
							// NIEUW: Groepsverwijdering voor muren
							let targets = [objectToDelete];
							if (objectToDelete.isWall && objectToDelete.groupId) {
								targets = objects.filter((o) => o.groupId === objectToDelete.groupId);
							}

							// NIEUW: Refund logica (50% terug bij verwijderen eigen object)
							let totalRefund = 0;
							targets.forEach((t) => {
								if (!isUserAdmin && t.price && t.ownerId === mySocketId) {
									totalRefund += t.price / 2;
								}
							});

							if (totalRefund > 0) {
								addToWallet(totalRefund);
								showNotification(`<span style="color: #7bff00;">+€${totalRefund.toFixed(2).replace(".", ",")}</span>`);
							}

							targets.forEach((target) => {
								const itemIndex = items.indexOf(target);
								if (itemIndex > -1) {
									socket.emit("removeItem", {
										x: Math.floor(target.x),
										y: Math.floor(target.y),
										type: target.type,
										name: target.name,
									});
									items.splice(itemIndex, 1);
								} else if (target.wallId) {
									socket.emit("removeWallObject", {
										id: target.id,
										wallId: target.wallId,
										name: target.name,
										ownerId: target.ownerId,
										isCustom: target.isCustom,
										image: target.image,
									});
								} else {
									const { runtimeImage, ...objectToSend } = target;
									socket.emit("removeObject", objectToSend);
								}
							});

							movePreview.style.display = "none"; // Verberg menu na verwijderen
						} else if (hoverTarget?.type === "wall") {
							socket.emit("removeWallObject", hoverTarget.id);
						} else {
							// Check of we een item verwijderen
							const itemToDeleteIndex = items.findIndex((item) => Math.floor(item.x) === x && Math.floor(item.y) === y);
							if (itemToDeleteIndex > -1) {
								const itemToDelete = items[itemToDeleteIndex];
								socket.emit("removeItem", { x: Math.floor(itemToDelete.x), y: Math.floor(itemToDelete.y) });
								items.splice(itemToDeleteIndex, 1);
							}
						}
						break;
				}
			} else if (activeBuildCategory === "kleur") {
				// --- Kleur Tool Logica ---

				// NIEUW: Check eerst of we op een custom muur klikken
				const mWorldX = (e.clientX - (window.innerWidth / 2 + camX)) / scale;
				const mWorldY = (e.clientY - (window.innerHeight / 4 + camY)) / scale;
				const customWall = objects
					.slice()
					.reverse()
					.find((o) => o.isWall && isMouseOverWall(o, mWorldX, mWorldY));
				hoveredCustomWallForColor = customWall; // Opslaan voor highlight in renderLoop

				if (customWall) {
					if (colorTool === "brush") {
						customWall.color = selectedColor;
						socket.emit("updateObjectColor", { id: customWall.id, color: selectedColor });
					} else if (colorTool === "picker") {
						const col = customWall.color || (customWall.flipped ? "#666" : "#555");
						colorPicker.color.hexString = col;
						showNotification(`Kleur gekopieerd: ${col}`);
					}
					return; // Stop hier, zodat we niet ook de vloer eronder kleuren
				}

				if (hoverTarget) {
					if (colorTool === "brush") {
						if (hoverTarget.type === "tile") {
							const tileKey = `${hoverTarget.id.x},${hoverTarget.id.y}`;
							tileColors[tileKey] = selectedColor;
							socket.emit("updateTileColor", { key: tileKey, color: selectedColor });
						} else if (hoverTarget.type === "wall") {
							wallColors[hoverTarget.id] = selectedColor;
							socket.emit("updateWallColor", { id: hoverTarget.id, color: selectedColor });
						}
					} else if (colorTool === "bucket") {
						const startNode = hoverTarget;

						const getTargetColor = (node) => {
							if (node.type === "tile") {
								return tileColors[`${node.id.x},${node.id.y}`] || "#444";
							}
							const defaultColor = node.id.startsWith("top") ? "#555" : "#666";
							return wallColors[node.id] || defaultColor;
						};

						const targetColor = getTargetColor(startNode);

						if (targetColor === selectedColor) return; // Voorkom oneindige loops

						const queue = [startNode];
						const visited = new Set();
						visited.add(JSON.stringify(startNode.id)); // Gebruik JSON.stringify voor unieke keys

						while (queue.length > 0) {
							const current = queue.shift();

							// Kleur het huidige element
							if (current.type === "tile") {
								tileColors[`${current.id.x},${current.id.y}`] = selectedColor;
								socket.emit("updateTileColor", { key: `${current.id.x},${current.id.y}`, color: selectedColor });
							} else {
								wallColors[current.id] = selectedColor;
								socket.emit("updateWallColor", { id: current.id, color: selectedColor });
							}

							// Vind buren
							let neighbors = [];
							if (current.type === "tile") {
								const { x, y } = current.id;
								neighbors = [
									{ type: "tile", id: { x: x + 1, y: y } },
									{ type: "tile", id: { x: x - 1, y: y } },
									{ type: "tile", id: { x: x, y: y + 1 } },
									{ type: "tile", id: { x: x, y: y - 1 } },
								].filter((n) => n.id.x >= 0 && n.id.x < mapW && n.id.y >= 0 && n.id.y < mapH);
							} else {
								// Wall
								const [type, indexStr] = current.id.split("_");
								const index = parseInt(indexStr);
								neighbors = [
									{ type: "wall", id: `${type}_${index + 1}` },
									{ type: "wall", id: `${type}_${index - 1}` },
								].filter((n) => {
									const i = parseInt(n.id.split("_")[1]);
									const max = type === "top" ? mapW : mapH;
									return i >= 0 && i < max;
								});
							}

							for (const neighbor of neighbors) {
								const neighborIdStr = JSON.stringify(neighbor.id);
								if (!visited.has(neighborIdStr)) {
									visited.add(neighborIdStr);
									if (getTargetColor(neighbor) === targetColor) {
										queue.push(neighbor);
									}
								}
							}
						}
					} else if (colorTool === "picker") {
						// --- Pipet Tool Logica ---
						let pickedColor = null;
						if (hoverTarget.type === "tile") {
							pickedColor = tileColors[`${hoverTarget.id.x},${hoverTarget.id.y}`] || "#444";
						} else if (hoverTarget.type === "wall") {
							const defaultColor = hoverTarget.id.startsWith("top") ? "#555" : "#666";
							pickedColor = wallColors[hoverTarget.id] || defaultColor;
						}

						if (pickedColor) {
							colorPicker.color.hexString = pickedColor;
							showNotification(`Kleur gekopieerd: ${pickedColor}`);
						}
					}
				}
			} else {
				hoveredCustomWallForColor = null;
			}
			return; // Bouwactie afgehandeld, stop verdere uitvoering
		}

		// Als het een klik was (niet een sleep) en niet in bouwmodus, start dan spelerbeweging
		if (e.button === 0 && Math.sqrt(dx * dx + dy * dy) < 5 && !isBuildMode) {
			// Alleen uitvoeren bij linkermuisknop
			const { x, y } = toTile(e.clientX, e.clientY);

			// NIEUW: Extra check om te voorkomen dat we lopen als we net een item hebben opgepakt
			// (Hoewel isItemDragging dit meestal al afvangt, kan de timing bij de timeout net verkeerd vallen)
			if (isItemDragging) return;

			if (x >= 0 && x < mapW && y >= 0 && y < mapH && !isBlocked(x, y, true)) {
				// NIEUW: Onderbreek roken bij verplaatsen
				if (isSmoking || isDrinking || isFilling) {
					interruptAction();
				}

				const startTile = { x: Math.floor(ball.x), y: Math.floor(ball.y) };
				path = findPath(startTile, { x, y });
				highlightedPath = [...path]; // Kopieer het pad voor highlighting

				if (!jumping && path.length > 0) {
					jumpStart = { x: ball.x, y: ball.y }; // voet als start
					const next = path.shift();
					jumpEnd = { x: next.x + 0.5, y: next.y + 0.5 }; // voet op midden tegel
					jumpProgress = 0;
					jumping = true;
				}
			}
		}
	});

	// Reset alle dragging states bij mouseleave
	canvas.addEventListener("mouseleave", (e) => {
		isCameraDragging = false;
		isObjectDragging = false;
		lastMarkerPos = null;

		// Reset hovers zodat highlights verdwijnen als je over UI gaat
		hoverCell = null;
		hoverTarget = null;

		// Item dragging wordt niet gereset bij mouseleave, zodat we naar de inventory kunnen slepen

		// NIEUW: Als we de canvas verlaten terwijl we wachten op pickup, annuleer pickup
		if (pickupTimer) {
			clearTimeout(pickupTimer);
			pickupTimer = null;
			pendingPickup = null;
		}
	});

	// Rechtermuisklik om bouwselectie te annuleren
	canvas.addEventListener("contextmenu", (e) => {
		e.preventDefault(); // Voorkom altijd het browser context menu op de canvas

		// Bepaal of het een klik was (geen sleepbeweging)
		const dx = e.clientX - dragStart.x;
		const dy = e.clientY - dragStart.y;
		const isClick = Math.sqrt(dx * dx + dy * dy) < 5 && !isCameraDragging; // Voeg check toe voor camera dragging

		// Voer de annuleer-actie alleen uit als het een 'klik' was en geen 'drag'
		if (isClick) {
			if (isBuildMode && selectedBuildObject) {
				selectedBuildObject = null;
				const selectedItem = document.querySelector(".build-item.selected");
				if (selectedItem) {
					selectedItem.classList.remove("selected");
					isBuildObjectFlipped = false;
				}
			}
			if (isBuildMode && movingObject) {
				if (movingObject.isItem) {
					const { image, isItem, ...itemToSend } = movingObject;
					socket.emit("placeItem", itemToSend);
				} else if (movingObject.wallId) {
					socket.emit("placeWallObject", {
						wallId: movingObject.wallId,
						name: movingObject.name,
						flipped: movingObject.flipped,
						image: movingObject.image,
						isCustom: movingObject.isCustom,
						ownerId: movingObject.ownerId,
					});
				} else {
					socket.emit("placeObject", movingObject); // Zet het object terug via server
				}
				movingObject = null;
				movePreview.style.display = "none";
			}
			// NIEUW: Annuleer item slepen met rechtermuisklik
			if (isItemDragging && draggedItem) {
				if (dragImageElement) {
					dragImageElement.remove();
					dragImageElement = null;
				}

				if (isDraggingFromInventory) {
					inventoryItems.push(draggedItem);
					savePlayerData(); // Opslaan
					renderInventoryItems();
				} else {
					draggedItem.x = draggedItemOriginalPos.x;
					draggedItem.y = draggedItemOriginalPos.y;
					items.push(draggedItem); // Zet item terug
					syncItems(); // Sync
				}
				isItemDragging = false;
				isDraggingFromInventory = false;
				if (isDraggingFromShop) {
					shopOutputItems.push(draggedItem);
					renderShopOutput();
				}
				if (isDraggingFromContainer && openContainer) {
					openContainer.items.push(draggedItem);
					renderContainerItems();
				}
				if (isDraggingFromVicinity) {
					draggedItem.x = draggedItemOriginalPos.x;
					draggedItem.y = draggedItemOriginalPos.y;
					items.push(draggedItem);
					syncItems();
				}
				draggedItem = null;
				draggedItemOriginalPos = null;
				// Heropen de vensters die open stonden
				if (windowStatesBeforeDrag) {
					if (windowStatesBeforeDrag.chat) document.getElementById("chatLog").style.display = windowStatesBeforeDrag.chat;
					if (windowStatesBeforeDrag.inventory) document.getElementById("inventory").style.display = windowStatesBeforeDrag.inventory;
					if (windowStatesBeforeDrag.vicinity) document.getElementById("vicinityWindow").style.display = windowStatesBeforeDrag.vicinity;
					if (windowStatesBeforeDrag.build === "flex") {
						buildBtn.click();
					}
					if (windowStatesBeforeDrag.shop === "flex") {
						document.getElementById("shopWindow").style.display = "flex";
					}
					if (windowStatesBeforeDrag.paper === "flex") {
						document.getElementById("paperWindow").style.display = "flex";
					}
					if (windowStatesBeforeDrag.newProject === "flex") {
						document.getElementById("newProjectWindow").style.display = "flex";
					}
					windowStatesBeforeDrag = null;
				}
			}
		}
	});

	// ─────────────────────────────────────────────
	// 🏪 WINKEL LOGICA
	// ─────────────────────────────────────────────
	const shopCatalog = [
		{
			name: "Batje Rood",
			image: batjeRoodImg,
			price: 15.0,
			mass: 0.4,
			canTopple: true,
			type: "bat_red",
			keywords: ["sport", "pingpong", "racket"],
		},
		{
			name: "Batje Zwart",
			image: batjeZwartImg,
			price: 15.0,
			mass: 0.4,
			canTopple: true,
			type: "bat_black",
			keywords: ["sport", "pingpong", "racket"],
		},
		{
			name: "Pakje sigaretten",
			image: sigarettenContainerImg,
			price: 20.0,
			mass: 0.2,
			type: "sigaretten_container",
			isPouch: true,
			keywords: ["pakkie", "peuken", "tabak", "peukie"],
		},
		{
			name: "Aansteker",
			image: aanstekerStickImg,
			price: 2.5,
			mass: 0.1,
			canTopple: true,
			type: "aansteker",
			uses: 50,
			keywords: ["vuurtje", "lichtje", "lighter", "gasbrander"],
		},
		{
			name: "Flesje water",
			image: bottleFullImg,
			price: 3.0,
			mass: 1.2,
			type: "bottle_full",
			keywords: ["drinken", "spa", "vloeistof", "vocht"],
		},
	];

	let currentOpenShop = null;

	function openShopWindow(shopObj) {
		currentOpenShop = shopObj;
		const shopWindow = document.getElementById("shopWindow");
		const shopContent = document.getElementById("shopContent");

		// Check voor brede winkel
		if (shopObj.width >= 2 || shopObj.depth >= 2) {
			shopWindow.style.width = "600px"; // Bredere winkel
			shopContent.style.gridTemplateColumns = "repeat(5, 1fr)"; // Meer kolommen
		} else {
			shopWindow.style.width = "380px"; // Standaard breedte
			shopContent.style.gridTemplateColumns = "repeat(3, 1fr)"; // Standaard kolommen
		}

		shopWindow.style.display = "flex";
		renderShopItems();
		renderShopOutput();

		// Open ook de inventory voor gemak
		inventory.style.display = "flex";
		document.querySelector("#inventoryBtn img").src = "icons/inventory_active.png";
		renderInventoryItems();
	}

	// ─────────────────────────────────────────────
	// 📍 VICINITY (OMGEVING) LOGICA
	// ─────────────────────────────────────────────
	const vicinityWindow = document.getElementById("vicinityWindow");
	const vicinityContent = document.getElementById("vicinityContent");
	const closeVicinityWindowBtn = document.getElementById("closeVicinityWindowBtn");
	let vicinityInterval = null;

	if (closeVicinityWindowBtn) {
		closeVicinityWindowBtn.addEventListener("click", () => {
			vicinityWindow.style.display = "none";
			if (vicinityInterval) clearInterval(vicinityInterval);
			document.querySelector("#vicinityBtn img").src = "icons/vicinity.png";
		});
	}

	function renderVicinityItems() {
		if (vicinityWindow.style.display !== "flex") return;

		vicinityContent.innerHTML = "";
		const playerX = Math.floor(ball.x);
		const playerY = Math.floor(ball.y);

		// Filter items binnen 2 tegels
		const nearbyItems = items.filter((item) => {
			const dist = Math.sqrt(Math.pow(Math.floor(item.x) - playerX, 2) + Math.pow(Math.floor(item.y) - playerY, 2));
			return dist <= 2;
		});

		if (nearbyItems.length === 0) {
			vicinityContent.innerHTML = '<div style="color:#aaa; width:100%; text-align:center; margin-top:20px;"></div>';
			return;
		}

		nearbyItems.forEach((item) => {
			const div = document.createElement("div");
			div.className = "inventory-item";
			div.style.width = "64px";
			div.style.height = "64px";
			div.style.position = "relative"; // Voor normale flow
			div.style.left = "auto";
			div.style.top = "auto";

			const imgSrc = item.image ? item.image.src : createItemFromData(item).image.src;
			div.innerHTML = `<img src="${imgSrc}">`;

			div.addEventListener("mousedown", (e) => {
				e.preventDefault();
				if (e.button === 0) {
					// Start slepen vanuit vicinity (wereld)
					const index = items.indexOf(item);
					if (index > -1) {
						items.splice(index, 1);
						syncItems(); // Verwijder uit wereld voor iedereen

						draggedItem = item;
						draggedItemOriginalPos = { x: item.x, y: item.y };
						isItemDragging = true;
						isDraggingFromVicinity = true;
						isDraggingFromInventory = false;
						isDraggingFromShop = false;
						isDraggingFromContainer = false;

						// Visueel element
						dragImageElement = document.createElement("img");
						dragImageElement.src = imgSrc;
						dragImageElement.style.position = "absolute";
						dragImageElement.style.pointerEvents = "none";
						dragImageElement.style.zIndex = "9999";
						dragImageElement.style.imageRendering = "pixelated";
						const w = (item.image && item.image.width ? item.image.width : 64) * scale;
						dragImageElement.style.width = w + "px";
						dragImageElement.style.left = e.clientX - w / 2 + "px";
						dragImageElement.style.top = e.clientY - w / 2 + "px";
						document.body.appendChild(dragImageElement);

						renderVicinityItems(); // Update lijst direct
					}
				}
			});

			vicinityContent.appendChild(div);
		});
	}

	// Sleep logica voor vicinity header
	const vicinityHeader = document.getElementById("vicinityHeader");
	let isDraggingVicinity = false;
	let dragStartVicinity = { x: 0, y: 0 };
	let vicinityStartPos = { x: 0, y: 0 };

	if (vicinityHeader) {
		vicinityHeader.addEventListener("mousedown", (e) => {
			bringToFront(vicinityWindow);
			isDraggingVicinity = true;
			dragStartVicinity = { x: e.clientX, y: e.clientY };
			const rect = vicinityWindow.getBoundingClientRect();
			vicinityWindow.style.left = rect.left + "px";
			vicinityWindow.style.top = rect.top + "px";
			vicinityStartPos = { x: rect.left, y: rect.top };
			e.preventDefault();
		});
	}

	window.addEventListener("mousemove", (e) => {
		if (!isDraggingVicinity) return;
		const dx = e.clientX - dragStartVicinity.x;
		const dy = e.clientY - dragStartVicinity.y;
		const newX = Math.max(0, Math.min(vicinityStartPos.x + dx, window.innerWidth - vicinityWindow.offsetWidth));
		const newY = Math.max(0, Math.min(vicinityStartPos.y + dy, window.innerHeight - vicinityWindow.offsetHeight - 50));
		vicinityWindow.style.left = newX + "px";
		vicinityWindow.style.top = newY + "px";
	});

	window.addEventListener("mouseup", () => {
		isDraggingVicinity = false;
	});

	document.getElementById("closeShopBtn").addEventListener("click", () => {
		document.getElementById("shopWindow").style.display = "none";
		currentOpenShop = null;
	});

	// Functie om de bouwknop in de footer te updaten
	function updateBuildButton() {
		const btn = document.getElementById("buildBtn");
		const img = btn.querySelector("img");

		// Admin en Eigenaar mogen altijd bouwen. Anderen alleen als allowBuilding true is.
		const canBuild = isUserAdmin || isRoomOwner || currentRoomSettings.allowBuilding;

		if (canBuild) {
			btn.style.pointerEvents = "auto";
			btn.style.opacity = "1";
			if (img.src.includes("buildmenu_inactive.png")) img.src = "icons/buildmenu.png";
		} else {
			btn.style.pointerEvents = "none";
			img.src = "icons/buildmenu_inactive.png";
			if (isBuildMode) closeBuildAdminMenu(); // Sluit menu als rechten worden ingetrokken
		}
	}

	// ROLE SELECTION LOGICA
	const roleSelector = document.getElementById("roleSelector");
	const rolePlayerBtn = document.getElementById("rolePlayerBtn");
	const roleAdminBtn = document.getElementById("roleAdminBtn");

	// NIEUW: Check of rol al gekozen is in deze sessie
	const storedRole = sessionStorage.getItem("habboRole");
	if (storedRole) {
		if (roleSelector) roleSelector.style.display = "none";
		if (storedRole === "admin") {
			isUserAdmin = true;
			updateBuildButton();
		} else {
			isUserAdmin = false;
			if (document.getElementById("adminBtn")) document.getElementById("adminBtn").style.display = "none";
			if (document.getElementById("cheatBtn")) document.getElementById("cheatBtn").style.display = "none";
			updateBuildButton();
		}
	}

	if (rolePlayerBtn) {
		rolePlayerBtn.addEventListener("click", () => {
			sessionStorage.setItem("habboRole", "player"); // Opslaan

			const urlParams = new URLSearchParams(window.location.search);
			const currentRoom = urlParams.get("room");

			// Als we al in een studio zitten, verberg het menu alleen
			if (currentRoom && currentRoom.startsWith("alumni-") && currentRoom.endsWith("-studio")) {
				roleSelector.style.display = "none";
				isUserAdmin = false;
				if (document.getElementById("adminBtn")) document.getElementById("adminBtn").style.display = "none";
				if (document.getElementById("cheatBtn")) document.getElementById("cheatBtn").style.display = "none";
				updateBuildButton();
			} else {
				// Anders: maak een nieuwe studio aan en ga erheen
				const randomId = Math.floor(Math.random() * 1000)
					.toString()
					.padStart(3, "0");
				const roomName = `alumni-${randomId}-studio`;
				window.location.search = `?room=${roomName}&size=10`;
			}
		});
	}
	if (roleAdminBtn) {
		roleAdminBtn.addEventListener("click", () => {
			sessionStorage.setItem("habboRole", "admin"); // Opslaan
			roleSelector.style.display = "none";
			isUserAdmin = true;
			updateBuildButton();
		});
	}

	// ROOMS BUTTON LOGICA
	const roomsBtn = document.getElementById("roomsBtn");
	const roomsWindow = document.getElementById("roomsWindow");
	const closeRoomsBtn = document.getElementById("closeRoomsBtn");

	if (roomsBtn) {
		roomsBtn.addEventListener("click", () => {
			if (roomsWindow.style.display === "flex") {
				roomsWindow.style.display = "none";
				roomsBtn.querySelector("img").src = "icons/rooms.png";
			} else {
				roomsWindow.style.display = "flex";
				roomsBtn.querySelector("img").src = "icons/rooms_active.png";
				socket.emit("getRooms");
				bringToFront(roomsWindow);
			}
		});
	}

	if (closeRoomsBtn) {
		closeRoomsBtn.addEventListener("click", () => {
			roomsWindow.style.display = "none";
			roomsBtn.querySelector("img").src = "icons/rooms.png";
		});
	}

	// MY ROOM BUTTON LOGICA
	const myRoomBtn = document.getElementById("myRoomBtn");
	const myRoomWindow = document.getElementById("myRoomWindow");
	const closeMyRoomBtn = document.getElementById("closeMyRoomBtn");
	const myRoomContent = document.getElementById("myRoomContent");

	function renderMyRoomSettings() {
		myRoomContent.innerHTML = "";

		if (!myRoomId) {
			myRoomContent.innerHTML = '<div style="padding:10px; color:#aaa;"></div>';
			return;
		}

		const urlParams = new URLSearchParams(window.location.search);
		const currentRoomId = urlParams.get("room") || "testroom";

		// Header met deurbel (alleen icoon)
		const headerDiv = document.createElement("div");
		headerDiv.style.display = "flex";
		headerDiv.style.justifyContent = "center";
		headerDiv.style.gap = "15px";
		headerDiv.style.marginBottom = "15px";
		headerDiv.style.borderBottom = "1px solid #444";
		headerDiv.style.paddingBottom = "10px";

		const bellIcon = document.createElement("img");
		bellIcon.src = myRoomSettings.doorbell ? "icons/bel_active.png" : "icons/bel.png";
		bellIcon.style.width = "16px";
		bellIcon.style.height = "16px";
		bellIcon.style.imageRendering = "pixelated";
		bellIcon.style.cursor = "pointer";
		bellIcon.title = "Deurbel " + (myRoomSettings.doorbell ? "AAN" : "UIT");

		bellIcon.onclick = () => {
			myRoomSettings.doorbell = !myRoomSettings.doorbell;
			socket.emit("updateRoomSettings", { roomId: myRoomId, settings: { doorbell: myRoomSettings.doorbell } });
			renderMyRoomSettings(); // Re-render local state immediately
		};

		const roomsIcon = document.createElement("img");
		const isMyRoom = currentRoomId === myRoomId;
		roomsIcon.src = isMyRoom ? "icons/rooms_active.png" : "icons/rooms.png";
		roomsIcon.style.width = "16px";
		roomsIcon.style.height = "16px";
		roomsIcon.style.imageRendering = "pixelated";
		roomsIcon.style.cursor = "pointer";
		roomsIcon.title = "Ga naar mijn studio";

		roomsIcon.onclick = () => {
			if (!isMyRoom) {
				window.location.search = `?room=${myRoomId}`;
			}
		};

		// Build Permission Toggle
		const buildIcon = document.createElement("img");
		buildIcon.src = myRoomSettings.allowBuilding ? "icons/buildmenu_active.png" : "icons/buildmenu.png";
		buildIcon.style.width = "16px";
		buildIcon.style.height = "16px";
		buildIcon.style.imageRendering = "pixelated";
		buildIcon.style.cursor = "pointer";
		buildIcon.title = "Bouwen door anderen: " + (myRoomSettings.allowBuilding ? "TOEGESTAAN" : "VERBODEN");

		buildIcon.onclick = () => {
			myRoomSettings.allowBuilding = !myRoomSettings.allowBuilding;
			socket.emit("updateRoomSettings", { roomId: myRoomId, settings: { allowBuilding: myRoomSettings.allowBuilding } });
			renderMyRoomSettings();
		};

		// No Smoking Toggle
		const smokeIcon = document.createElement("img");
		smokeIcon.src = myRoomSettings.noSmoking ? "icons/verboden_active.png" : "icons/verboden.png";
		smokeIcon.style.width = "16px";
		smokeIcon.style.height = "16px";
		smokeIcon.style.imageRendering = "pixelated";
		smokeIcon.style.cursor = "pointer";
		smokeIcon.title = "Roken: " + (myRoomSettings.noSmoking ? "VERBODEN" : "TOEGESTAAN");

		smokeIcon.onclick = () => {
			myRoomSettings.noSmoking = !myRoomSettings.noSmoking;
			socket.emit("updateRoomSettings", { roomId: myRoomId, settings: { noSmoking: myRoomSettings.noSmoking } });
			renderMyRoomSettings();
		};

		headerDiv.appendChild(bellIcon);
		headerDiv.appendChild(buildIcon);
		headerDiv.appendChild(smokeIcon);
		headerDiv.appendChild(roomsIcon);
		myRoomContent.appendChild(headerDiv);

		// Spelerslijst
		const listContainer = document.createElement("div");
		listContainer.style.overflowY = "auto";
		listContainer.style.maxHeight = "200px";

		if (currentRoomId === myRoomId) {
			if (Object.keys(otherPlayers).length === 0) {
			} else {
				Object.values(otherPlayers).forEach((p) => {
					const row = document.createElement("div");
					row.style.display = "flex";
					row.style.justifyContent = "space-between";
					row.style.alignItems = "center";
					row.style.padding = "8px 5px";
					row.style.borderBottom = "1px solid #333";

					const nameSpan = document.createElement("span");
					nameSpan.textContent = p.name;

					const actionsDiv = document.createElement("div");
					actionsDiv.style.display = "flex";
					actionsDiv.style.gap = "10px";

					// Heart Icon
					const isAlreadyFriend = myFriends.some((friend) => friend.userId === p.userId);
					const heartBtn = document.createElement("img");
					heartBtn.src = isAlreadyFriend ? "icons/heart_active.png" : "icons/heart.png";
					heartBtn.style.width = "20px";
					heartBtn.style.height = "20px";
					heartBtn.title = isAlreadyFriend ? "Vrienden" : "Vriend toevoegen";

					if (!isAlreadyFriend) {
						heartBtn.style.cursor = "pointer";
						heartBtn.onclick = () => {
							showConfirmation({
								message: `Wil je een vriendschapsverzoek sturen naar ${p.name}?`,
								icon: "icons/heart.png",
								onConfirm: () => socket.emit("sendFriendRequest", { targetId: p.id }),
							});
						};
					}

					// Kick Icon (alleen als je eigenaar bent)
					if (isRoomOwner) {
						const kickBtn = document.createElement("img");
						kickBtn.src = "icons/kick.png";
						kickBtn.style.width = "20px";
						kickBtn.style.height = "20px";
						kickBtn.style.cursor = "pointer";
						kickBtn.title = "Kicken";

						kickBtn.onmousedown = () => {
							kickBtn.src = "icons/kick_active.png";
						};
						kickBtn.onmouseup = () => {
							kickBtn.src = "icons/kick.png";
						};
						kickBtn.onmouseleave = () => {
							kickBtn.src = "icons/kick.png";
						};

						kickBtn.onclick = () => {
							showConfirmation({
								message: `Wil je ${p.name} kicken uit je studio?`,
								icon: "icons/kick.png",
								onConfirm: () => socket.emit("kickPlayer", { targetId: p.id }),
							});
						};
						actionsDiv.appendChild(kickBtn);
					}

					actionsDiv.appendChild(heartBtn);

					row.appendChild(nameSpan);
					row.appendChild(actionsDiv);
					listContainer.appendChild(row);
				});
			}
		}

		myRoomContent.appendChild(listContainer);
	}

	if (myRoomBtn) {
		myRoomBtn.addEventListener("click", () => {
			if (myRoomWindow.style.display === "flex") {
				myRoomWindow.style.display = "none";
				myRoomBtn.querySelector("img").src = "icons/myroom.png";
			} else {
				myRoomWindow.style.display = "flex";
				myRoomBtn.querySelector("img").src = "icons/myroom_active.png";
				bringToFront(myRoomWindow);
				renderMyRoomSettings();
			}
		});
	}
	if (closeMyRoomBtn) {
		closeMyRoomBtn.addEventListener("click", () => {
			myRoomWindow.style.display = "none";
			myRoomBtn.querySelector("img").src = "icons/myroom.png";
		});
	}

	const closeRoomPlayersBtn = document.getElementById("closeRoomPlayersBtn");
	if (closeRoomPlayersBtn) {
		closeRoomPlayersBtn.addEventListener("click", () => {
			document.getElementById("roomPlayersWindow").style.display = "none";
		});
	}

	// FRIENDS BUTTON LOGICA
	const friendsBtn = document.getElementById("friendsBtn");
	const friendsWindow = document.getElementById("friendsWindow");
	const closeFriendsBtn = document.getElementById("closeFriendsBtn");

	if (friendsBtn) {
		friendsBtn.addEventListener("click", () => {
			if (friendsWindow.style.display === "flex") {
				friendsWindow.style.display = "none";
				friendsBtn.querySelector("img").src = "icons/heart.png";
			} else {
				friendsWindow.style.display = "flex";
				friendsBtn.querySelector("img").src = "icons/heart_active.png";
				bringToFront(friendsWindow);
				socket.emit("getFriends");
			}
		});
	}
	if (closeFriendsBtn) {
		closeFriendsBtn.addEventListener("click", () => {
			friendsWindow.style.display = "none";
			friendsBtn.querySelector("img").src = "icons/heart.png";
		});
	}

	// CHEAT BUTTON LOGICA
	document.getElementById("cheatBtn").addEventListener("click", () => {
		addToWallet(1000);
		showNotification("Cheats: €1000 toegevoegd!");
	});

	function renderShopItems() {
		const content = document.getElementById("shopContent");
		content.innerHTML = "";

		const searchInput = document.getElementById("shopSearchInput");
		const sortSelect = document.getElementById("shopSortSelect");
		const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";
		const sortMode = sortSelect ? sortSelect.value : "name_asc";

		let displayItems = shopCatalog.filter((item) => {
			const nameMatch = item.name.toLowerCase().includes(searchTerm);
			const keywordMatch = item.keywords && item.keywords.some((k) => k.toLowerCase().includes(searchTerm));
			return nameMatch || keywordMatch;
		});

		displayItems.sort((a, b) => {
			if (sortMode === "name_asc") return a.name.localeCompare(b.name);
			if (sortMode === "name_desc") return b.name.localeCompare(a.name);
			if (sortMode === "price_asc") return a.price - b.price;
			if (sortMode === "price_desc") return b.price - a.price;
			return 0;
		});

		displayItems.forEach((item) => {
			const div = document.createElement("div");
			div.className = "build-item"; // Hergebruik stijl
			div.style.height = "auto";
			div.style.minHeight = "90px";
			div.innerHTML = `
            <img src="${item.image.src}" style="height: 48px; object-fit: contain;">
            <div style="text-align:center;">
                <div>${item.name}</div>
                <div style="color: #7bff00;">€${item.price.toFixed(2)}</div>
            </div>
        `;

			div.onclick = () => buyItem(item);
			content.appendChild(div);
		});
	}

	// Event listeners voor winkel filters
	const shopSearchInput = document.getElementById("shopSearchInput");
	if (shopSearchInput) shopSearchInput.addEventListener("input", renderShopItems);

	const shopSortSelect = document.getElementById("shopSortSelect");
	if (shopSortSelect) shopSortSelect.addEventListener("change", renderShopItems);

	function buyItem(template) {
		if (walletBalance >= template.price) {
			addToWallet(-template.price);

			// Maak een nieuw item aan
			const newItem = {
				...template, // Kopieer eigenschappen
				x: 0,
				y: 0,
				vx: 0,
				vy: 0,
				z: 0,
				vz: 0,
				rotation: 0,
				vr: 0,
			};

			// NIEUW: Als het een pakje sigaretten is, vul het volledig (20 stuks)
			if (newItem.type === "sigaretten_container") {
				newItem.items = [];
				for (let i = 0; i < 20; i++) {
					newItem.items.push(
						createItemFromData({
							type: "sigaret",
							name: "Sigaret",
							mass: 0.05,
							canTopple: true,
							vx: 0,
							vy: 0,
							vz: 0,
							rotation: 0,
							vr: 0, // NIEUW: Physics initialiseren
						})
					);
				}
			}

			shopOutputItems.push(newItem);
			renderShopOutput();
		} else {
			showNotification("Niet genoeg geld!");
		}
	}

	function renderShopOutput() {
		const output = document.getElementById("shopOutput");
		output.innerHTML = "";

		shopOutputItems.forEach((item, index) => {
			const div = document.createElement("div");
			div.className = "inventory-item";
			div.style.width = "64px";
			div.style.height = "64px";
			div.innerHTML = `<img src="${item.image.src}">`;

			div.addEventListener("mousedown", (e) => {
				e.preventDefault();
				if (e.button === 0) {
					// Haal uit shop output
					shopOutputItems.splice(index, 1);
					renderShopOutput();

					// Start slepen
					draggedItem = item;
					isItemDragging = true;
					isDraggingFromShop = true;
					isDraggingFromInventory = false;
					draggedItemOriginalPos = null;

					// Visueel element
					dragImageElement = document.createElement("img");
					dragImageElement.src = draggedItem.image.src;
					dragImageElement.style.position = "absolute";
					dragImageElement.style.pointerEvents = "none";
					dragImageElement.style.zIndex = "9999";
					dragImageElement.style.imageRendering = "pixelated";
					const w = (draggedItem.image.width || 64) * scale;
					const h = (draggedItem.image.height || 64) * scale;
					dragImageElement.style.width = w + "px";
					dragImageElement.style.left = e.clientX - w / 2 + "px";
					dragImageElement.style.top = e.clientY - h / 2 + "px";
					document.body.appendChild(dragImageElement);
				}
			});

			output.appendChild(div);
		});
	}

	// Sleep logica voor shop header
	const shopWindow = document.getElementById("shopWindow");
	const shopHeader = document.getElementById("shopHeader");
	let isDraggingShop = false;
	let dragStartShop = { x: 0, y: 0 };
	let shopStartPos = { x: 0, y: 0 };

	shopHeader.addEventListener("mousedown", (e) => {
		bringToFront(shopWindow);
		isDraggingShop = true;
		dragStartShop = { x: e.clientX, y: e.clientY };
		const rect = shopWindow.getBoundingClientRect();
		// Reset transform voor absoluut slepen
		shopWindow.style.transform = "none";
		shopWindow.style.left = rect.left + "px";
		shopWindow.style.top = rect.top + "px";
		shopStartPos = { x: rect.left, y: rect.top };
	});

	// Zoom knoppen
	document.getElementById("zoomIn").addEventListener("click", () => {
		if (currentZoomIndex < zoomLevels.length - 1) {
			currentZoomIndex++;
			scale = zoomLevels[currentZoomIndex];
		}
	});
	document.getElementById("zoomOut").addEventListener("click", () => {
		if (currentZoomIndex > 0) {
			currentZoomIndex--;
			scale = zoomLevels[currentZoomIndex];
		}
	});

	let scaleTarget = 1; // Definieer scaleTarget buiten de center knop

	// Center knop
	document.getElementById("centerCam").addEventListener("click", () => {
		camTargetX = 0;
		camTargetY = 0;
		currentZoomIndex = 2; // Index voor neutraal zoomlevel (1.0)
		scaleTarget = zoomLevels[currentZoomIndex];
		camSmooth = true;
	});

	const setupStatefulButton = (btn, normalIcon, activeIcon) => {
		if (!btn) return;
		const img = btn.querySelector("img");
		if (!img) return;

		btn.addEventListener("mousedown", () => {
			img.src = activeIcon;
		});

		const resetIcon = () => {
			img.src = normalIcon;
		};
		btn.addEventListener("mouseup", resetIcon);
		btn.addEventListener("mouseleave", resetIcon);
	};

	setupStatefulButton(document.getElementById("zoomIn"), "icons/max.png", "icons/max_active.png");
	setupStatefulButton(document.getElementById("zoomOut"), "icons/min.png", "icons/min_active.png");
	setupStatefulButton(document.getElementById("centerCam"), "icons/center.png", "icons/center_active.png");

	function updateCamera(delta) {
		if (!camSmooth || delta === 0) return;
		let dx = camTargetX - camX;
		let dy = camTargetY - camY;
		let distance = Math.sqrt(dx * dx + dy * dy);
		let t = Math.min(0.08 * delta, distance * 0.01);
		camX += dx * t;
		camY += dy * t;

		// Smooth zoom
		let ds = scaleTarget - scale;
		scale += ds * 0.08 * delta;

		if (distance < 0.3 && Math.abs(ds) < 0.01) {
			camX = camTargetX;
			camY = camTargetY;
			scale = scaleTarget;
			currentZoomIndex = zoomLevels.indexOf(scaleTarget); // Synchroniseer de index
			camSmooth = false;
		}
	}

	window.addEventListener("mousemove", (e) => {
		if (!isDraggingShop) return;

		const dx = e.clientX - dragStartShop.x;
		const dy = e.clientY - dragStartShop.y;

		const newX = Math.max(0, Math.min(shopStartPos.x + dx, window.innerWidth - shopWindow.offsetWidth));
		const newY = Math.max(0, Math.min(shopStartPos.y + dy, window.innerHeight - shopWindow.offsetHeight - 50));

		shopWindow.style.left = newX + "px";
		shopWindow.style.top = newY + "px";
	});

	// Sleep logica voor myRoom header
	const myRoomHeader = document.getElementById("myRoomHeader");
	let isDraggingMyRoom = false;
	let dragStartMyRoom = { x: 0, y: 0 };
	let myRoomStartPos = { x: 0, y: 0 };

	if (myRoomHeader) {
		myRoomHeader.addEventListener("mousedown", (e) => {
			bringToFront(myRoomWindow);
			isDraggingMyRoom = true;
			dragStartMyRoom = { x: e.clientX, y: e.clientY };
			const rect = myRoomWindow.getBoundingClientRect();
			myRoomWindow.style.transform = "none";
			myRoomWindow.style.left = rect.left + "px";
			myRoomWindow.style.top = rect.top + "px";
			myRoomStartPos = { x: rect.left, y: rect.top };
		});
	}

	window.addEventListener("mousemove", (e) => {
		if (!isDraggingMyRoom) return;
		const dx = e.clientX - dragStartMyRoom.x;
		const dy = e.clientY - dragStartMyRoom.y;
		const newX = Math.max(0, Math.min(myRoomStartPos.x + dx, window.innerWidth - myRoomWindow.offsetWidth));
		const newY = Math.max(0, Math.min(myRoomStartPos.y + dy, window.innerHeight - myRoomWindow.offsetHeight - 50));
		myRoomWindow.style.left = newX + "px";
		myRoomWindow.style.top = newY + "px";
	});

	// Sleep logica voor roomPlayers header
	const roomPlayersWindow = document.getElementById("roomPlayersWindow");
	const roomPlayersHeader = document.getElementById("roomPlayersHeader");
	let isDraggingRoomPlayers = false;
	let dragStartRoomPlayers = { x: 0, y: 0 };
	let roomPlayersStartPos = { x: 0, y: 0 };

	if (roomPlayersHeader) {
		roomPlayersHeader.addEventListener("mousedown", (e) => {
			bringToFront(roomPlayersWindow);
			isDraggingRoomPlayers = true;
			dragStartRoomPlayers = { x: e.clientX, y: e.clientY };
			const rect = roomPlayersWindow.getBoundingClientRect();
			roomPlayersWindow.style.transform = "none";
			roomPlayersWindow.style.left = rect.left + "px";
			roomPlayersWindow.style.top = rect.top + "px";
			roomPlayersStartPos = { x: rect.left, y: rect.top };
		});
	}

	window.addEventListener("mousemove", (e) => {
		if (!isDraggingRoomPlayers) return;
		const dx = e.clientX - dragStartRoomPlayers.x;
		const dy = e.clientY - dragStartRoomPlayers.y;
		const newX = Math.max(0, Math.min(roomPlayersStartPos.x + dx, window.innerWidth - roomPlayersWindow.offsetWidth));
		const newY = Math.max(0, Math.min(roomPlayersStartPos.y + dy, window.innerHeight - roomPlayersWindow.offsetHeight - 50));
		roomPlayersWindow.style.left = newX + "px";
		roomPlayersWindow.style.top = newY + "px";
	});

	// Sleep logica voor friends header
	const friendsHeader = document.getElementById("friendsHeader");
	let isDraggingFriends = false;
	let dragStartFriends = { x: 0, y: 0 };
	let friendsStartPos = { x: 0, y: 0 };

	if (friendsHeader) {
		friendsHeader.addEventListener("mousedown", (e) => {
			bringToFront(friendsWindow);
			isDraggingFriends = true;
			dragStartFriends = { x: e.clientX, y: e.clientY };
			const rect = friendsWindow.getBoundingClientRect();
			friendsWindow.style.transform = "none";
			friendsWindow.style.left = rect.left + "px";
			friendsWindow.style.top = rect.top + "px";
			friendsStartPos = { x: rect.left, y: rect.top };
		});
	}

	window.addEventListener("mousemove", (e) => {
		if (!isDraggingFriends) return;
		const dx = e.clientX - dragStartFriends.x;
		const dy = e.clientY - dragStartFriends.y;
		const newX = Math.max(0, Math.min(friendsStartPos.x + dx, window.innerWidth - friendsWindow.offsetWidth));
		const newY = Math.max(0, Math.min(friendsStartPos.y + dy, window.innerHeight - friendsWindow.offsetHeight - 50));
		friendsWindow.style.left = newX + "px";
		friendsWindow.style.top = newY + "px";
	});

	// Sleep logica voor paper header
	const paperHeader = document.getElementById("paperHeader");
	let isDraggingPaper = false;
	let dragStartPaper = { x: 0, y: 0 };
	let paperStartPos = { x: 0, y: 0 };

	if (paperHeader) {
		paperHeader.addEventListener("mousedown", (e) => {
			bringToFront(paperWindow);
			isDraggingPaper = true;
			dragStartPaper = { x: e.clientX, y: e.clientY };
			const rect = paperWindow.getBoundingClientRect();
			paperWindow.style.transform = "none"; // Reset transform
			paperWindow.style.left = rect.left + "px";
			paperWindow.style.top = rect.top + "px";
			paperStartPos = { x: rect.left, y: rect.top };
		});
	}

	window.addEventListener("mousemove", (e) => {
		if (!isDraggingPaper) return;
		const dx = e.clientX - dragStartPaper.x;
		const dy = e.clientY - dragStartPaper.y;
		const newX = Math.max(0, Math.min(paperStartPos.x + dx, window.innerWidth - paperWindow.offsetWidth));
		const newY = Math.max(0, Math.min(paperStartPos.y + dy, window.innerHeight - paperWindow.offsetHeight - 50));
		paperWindow.style.left = newX + "px";
		paperWindow.style.top = newY + "px";
	});

	// Sleep logica voor newProject header
	const newProjectHeader = document.getElementById("newProjectHeader");
	let isDraggingNewProject = false;
	let dragStartNewProject = { x: 0, y: 0 };
	let newProjectStartPos = { x: 0, y: 0 };

	if (newProjectHeader) {
		newProjectHeader.addEventListener("mousedown", (e) => {
			bringToFront(newProjectWindow);
			isDraggingNewProject = true;
			dragStartNewProject = { x: e.clientX, y: e.clientY };
			const rect = newProjectWindow.getBoundingClientRect();
			newProjectWindow.style.transform = "none"; // Reset transform
			newProjectWindow.style.left = rect.left + "px";
			newProjectWindow.style.top = rect.top + "px";
			newProjectStartPos = { x: rect.left, y: rect.top };
		});
	}

	window.addEventListener("mousemove", (e) => {
		if (!isDraggingNewProject) return;
		const dx = e.clientX - dragStartNewProject.x;
		const dy = e.clientY - dragStartNewProject.y;
		const newX = Math.max(0, Math.min(newProjectStartPos.x + dx, window.innerWidth - newProjectWindow.offsetWidth));
		const newY = Math.max(0, Math.min(newProjectStartPos.y + dy, window.innerHeight - newProjectWindow.offsetHeight - 50));
		newProjectWindow.style.left = newX + "px";
		newProjectWindow.style.top = newY + "px";
	});

	// ─────────────────────────────────────────────
	// 📦 CONTAINER LOGICA
	// ─────────────────────────────────────────────
	let openContainer = null; // Het container object dat momenteel open is

	function openContainerWindow(obj) {
		// NIEUW: Sluit andere container/pouch vensters om conflicten te voorkomen
		// Dit zorgt ervoor dat de state (openContainer, openPouch) niet gedeeld wordt.
		document.getElementById("containerWindow").style.display = "none";
		document.getElementById("pouchWindow").style.display = "none";
		openContainer = null;
		openPouch = null;

		openContainer = obj;
		// Initialiseer items array als die nog niet bestaat
		if (!openContainer.items) {
			openContainer.items = [];
		}

		const containerWindow = document.getElementById("containerWindow");
		const containerTools = document.getElementById("containerTools");
		const containerContent = document.getElementById("containerContent");

		if (obj.isPouch || obj.type === "pouch") {
			return openPouchWindow(obj);
		}

		// Update de titel van het venster
		containerWindow.querySelector("#containerHeader span").textContent = obj.name || "Container";

		// Reset tools en content hoogte
		containerTools.innerHTML = "";
		containerTools.style.display = "none";
		containerContent.style.height = "calc(100% - 36px)";

		// Voeg prullenbak-knop toe indien nodig
		if (obj.subCategory === "trash" || obj.name.includes("Prullenbak")) {
			containerTools.style.display = "flex";
			containerContent.style.height = "calc(100% - 36px - 51px)"; // 36px header + 51px tools

			const trashBtn = document.createElement("button");
			trashBtn.className = "tool-btn";
			trashBtn.style.background = "transparent";
			trashBtn.style.border = "none";
			trashBtn.title = "Leegmaken";

			const trashIcon = document.createElement("img");
			trashIcon.src = "icons/trash.png";
			trashIcon.style.width = "24px";
			trashIcon.style.height = "24px";

			trashBtn.appendChild(trashIcon);

			trashBtn.onclick = () => {
				// Voer alleen actie uit als er items zijn om te verwijderen
				if (openContainer && openContainer.items.length > 0) {
					// Verander icoon naar 'actief'
					trashIcon.src = "icons/trash_active.png";

					// Leeg de items array
					openContainer.items = [];

					// Wacht even, dan her-render en zet icoon terug
					setTimeout(() => {
						renderContainerItems(); // Her-render de (nu lege) container
						trashIcon.src = "icons/trash.png";
					}, 200);
				}
			};
			containerTools.appendChild(trashBtn);
		}

		// Bepaal de grootte van het venster op basis van de vorm van het object

		if (obj.height >= 2) {
			// "Hoge container" (Grote Container) -> Dun maar lang, als een locker
			containerWindow.style.width = "170px";
			containerWindow.style.height = "550px";
			obj.columns = 1;
		} else if (obj.width >= 2 || obj.depth >= 2) {
			// "Brede container" en "Brede prullenbak" -> Stuk breder
			containerWindow.style.width = "450px";
			containerWindow.style.height = "300px"; // Standaard hoogte
			obj.columns = 4; // Ruimte voor 4 kolommen
		} else {
			// Standaard voor "Container" en "Prullenbak"
			containerWindow.style.width = "260px"; // Standaard breedte voor 2 kolommen
			containerWindow.style.height = "300px"; // Standaard hoogte
			obj.columns = 2;
		}

		containerWindow.style.display = "flex";
		renderContainerItems();

		// Open ook de inventory voor gemak
		inventory.style.left = "150px"; // Reset positie voor netheid
		inventory.style.display = "flex";
		document.querySelector("#inventoryBtn img").src = "icons/inventory_active.png";
		renderInventoryItems();
	}

	document.getElementById("closeContainerBtn").addEventListener("click", () => {
		document.getElementById("containerWindow").style.display = "none";
		openContainer = null;
	});

	const pouchWindow = document.getElementById("pouchWindow");
	const closePouchBtn = document.getElementById("closePouchBtn");
	let openPouch = null;

	function openPouchWindow(pouchItem) {
		openPouch = pouchItem;
		if (!openPouch.items) {
			openPouch.items = [];
		}

		let title = pouchItem.name || "Pouch";
		const isCigPack = pouchItem.type === "sigaretten_container" || pouchItem.itemType === "sigaretten_container";

		// Forceer naam voor sigaretten container
		if (isCigPack) {
			title = "Pakje sigaretten";
			pouchWindow.style.width = "300px";
			pouchWindow.style.height = "180px";
		} else {
			pouchWindow.style.width = "260px";
			pouchWindow.style.height = "300px";
		}

		pouchWindow.querySelector("#pouchHeader span").textContent = title;
		pouchWindow.style.display = "flex";
		bringToFront(pouchWindow);
		renderPouchItems();
	}

	if (closePouchBtn) {
		closePouchBtn.addEventListener("click", () => {
			pouchWindow.style.display = "none";
			openPouch = null;
		});
	}

	function renderContainerItems() {
		if (!openContainer) return;
		const content = document.getElementById("containerContent");
		content.innerHTML = "";

		const cols = openContainer.columns || 2; // Default naar 2 als niet ingesteld

		openContainer.items.forEach((item, index) => {
			// Self-healing: herstel afbeelding indien nodig
			if (!item.image) {
				const hydrated = createItemFromData(item);
				item.image = hydrated.image;
			}

			const div = document.createElement("div");
			div.className = "inventory-item";
			const imgSrc = item.image ? item.image.src : "";

			// Default positie als die er nog niet is
			if (item.conX === undefined) {
				item.conX = (index % cols) * 110 + 20;
				item.conY = Math.floor(index / cols) * 110 + 20;
			}

			div.style.position = "absolute";
			div.style.left = item.conX + "px";
			div.style.top = item.conY + "px";
			div.innerHTML = `<img src="${imgSrc}">`;

			div.addEventListener("mousedown", (e) => {
				// Breng item naar voorgrond
				div.style.zIndex = ++highestContainerZ;

				// Update array volgorde
				const idx = openContainer.items.indexOf(item);
				if (idx > -1) {
					openContainer.items.push(openContainer.items.splice(idx, 1)[0]);
				}

				e.preventDefault();
				if (e.button === 0) {
					// Start met verplaatsen BINNEN de container
					isRearrangingContainer = true;
					activeContainerItem = item;

					const rect = div.getBoundingClientRect();
					containerDragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
					e.stopPropagation();
				}
			});
			content.appendChild(div);
		});
	}

	function renderPouchItems() {
		if (!openPouch) return;
		const content = document.getElementById("pouchContent");
		content.innerHTML = "";

		const isCigPack = openPouch.type === "sigaretten_container" || openPouch.itemType === "sigaretten_container";

		openPouch.items.forEach((item, index) => {
			// Self-healing: herstel afbeelding indien nodig
			if (!item.image) {
				const hydrated = createItemFromData(item);
				item.image = hydrated.image;
			}

			const div = document.createElement("div");
			div.className = "inventory-item";
			const imgSrc = item.image ? item.image.src : "";

			if (isCigPack) {
				// Statische grid layout voor sigaretten (3 rijen: 7, 6, 7)
				let row, col;
				let xOffset = 29; // Gecentreerd in 300px

				if (index < 7) {
					row = 0;
					col = index;
				} else if (index < 13) {
					row = 1;
					col = index - 7;
					xOffset += 17.5; // Verspringing voor honingraat effect
				} else {
					row = 2;
					col = index - 13;
				}

				div.style.width = "32px";
				div.style.height = "32px";
				div.style.padding = "0";
				div.style.transform = "scale(1)"; // Voorkom dat sigaretten 6x schalen

				// Bereken vaste positie
				item.conX = col * 35 + xOffset;
				item.conY = row * 35 + 25;
			} else if (item.conX === undefined) {
				item.conX = (index % 2) * 110 + 20;
				item.conY = Math.floor(index / 2) * 110 + 20;
			}

			div.style.position = "absolute";
			div.style.left = item.conX + "px";
			div.style.top = item.conY + "px";

			if (isCigPack) {
				let displayImg = imgSrc;
				// Gebruik speciaal icoon als het een sigaret in het pakje is
				if (item.type === "sigaret" || item.itemType === "sigaret") {
					displayImg = "icons/sigaret_in_container.png";
				} else if (item.type === "sigaret_half" || item.itemType === "sigaret_half") {
					displayImg = "icons/sigaret_H_in_container.png";
				}
				div.innerHTML = `<img src="${displayImg}" style="width:100%; height:100%; object-fit:contain;">`;
			} else {
				div.innerHTML = `<img src="${imgSrc}">`;
			}

			div.addEventListener("mousedown", (e) => {
				div.style.zIndex = ++highestContainerZ;

				const idx = openPouch.items.indexOf(item);
				if (idx > -1) {
					openPouch.items.push(openPouch.items.splice(idx, 1)[0]);
				}

				e.preventDefault();
				if (e.button === 0) {
					// Voor sigarettenpakje: sta slepen toe (om eruit te halen),
					// maar herschikken binnenin wordt door de statische render overruled.
					// We starten wel de drag logica zodat 'mousemove' werkt voor het eruit slepen.

					isRearrangingContainer = true; // Hergebruik vlag
					activePouchItem = item; // Gebruik aparte variabele

					const rect = div.getBoundingClientRect();
					containerDragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
					e.stopPropagation();
				}
			});
			content.appendChild(div);
		});
	}

	let lastPhysicsSync = 0; // NIEUW: Throttle timer

	function updateItems(delta) {
		const friction = 0.9; // AANGEPAST: Iets meer frictie (was 0.92) voor strakkere stop
		const dirtyItems = []; // NIEUW: Lijst met items die bewogen hebben

		items.forEach((item) => {
			// Sla over als het item wordt versleept
			if (item === draggedItem) return;

			// NIEUW: Update Z eerst, zodat we niet vastzitten in de grond voor de collision check
			const tileX = Math.floor(item.x);
			const tileY = Math.floor(item.y);
			const groundZ = getSurfaceHeight(tileX, tileY);
			if ((item.z || 0) < groundZ) {
				item.z = groundZ;
				item.vz = 0;
			}

			// NIEUW: Collision detection met objecten en muren
			let nextX = item.x + item.vx * delta;
			let nextY = item.y + item.vy * delta;
			const z = item.z || 0;

			// Helper om collision te checken op een punt
			const checkCol = (tx, ty) => {
				// Map grenzen
				if (tx < 0.5 || tx > mapW - 0.5 || ty < 0.5 || ty > mapH - 0.5) return true;

				// Objecten
				return objects.some((o) => {
					if (o.isFloor) return false;

					// NIEUW: Specifieke bounding box voor muren
					if (o.isWall) {
						if (o.isGate) return false; // NIEUW: Items kunnen door poorten
						const t = o.wallThickness || 0.25;
						const w = o.width || 1; // Lengte van de muur

						let minX, maxX, minY, maxY;

						if (o.flipped) {
							// Y-axis muur (loopt langs Y)
							// Staat op X. Loopt van Y tot Y+w. Dikte is X-t tot X.
							minX = o.x - t;
							maxX = o.x;
							minY = o.y;
							maxY = o.y + w;
						} else {
							// X-axis muur (loopt langs X)
							// Staat op Y. Loopt van X tot X+w. Dikte is Y-t tot Y.
							minX = o.x;
							maxX = o.x + w;
							minY = o.y - t;
							maxY = o.y;
						}

						// Check collision met item radius (kleine marge)
						const radius = 0.2; // Item radius
						// Aangepaste AABB check met radius
						if (tx + radius > minX && tx - radius < maxX && ty + radius > minY && ty - radius < maxY) {
							// Hoogte check
							const h = o.wallHeight || 150;
							if (z < h - 0.1) return true;
						}
						return false;
					}

					// Bestaande logica voor blokken/meubels (nu met radius)
					const w = o.flipped ? o.depth || 1 : o.width || 1;
					const d = o.flipped ? o.width || 1 : o.depth || 1;

					const radius = 0.2;
					// Check bounding box met radius
					if (tx + radius > o.x && tx - radius < o.x + w && ty + radius > o.y && ty - radius < o.y + d) {
						// Check hoogte (items kunnen over lage objecten vliegen)
						const h = (o.height || 1) * 32;
						// Epsilon check: alleen botsen als we echt lager zijn (marge van 0.1)
						if (z < h - 0.1) return true;
					}
					return false;
				});
			};

			// X-as beweging
			if (checkCol(nextX, item.y)) {
				item.vx *= -0.5; // Stuiter
			} else {
				item.x = nextX;
			}

			// Y-as beweging
			if (checkCol(item.x, nextY)) {
				item.vy *= -0.5; // Stuiter
			} else {
				item.y = nextY;
			}

			// Pas frictie toe op snelheid
			item.vx *= friction;
			item.vy *= friction;

			// Stop beweging als de snelheid heel laag is om eindeloos glijden te voorkomen
			if (Math.abs(item.vx) < 0.001) item.vx = 0;
			if (Math.abs(item.vy) < 0.001) item.vy = 0;

			// --- BONUS: Stuiter Logica (Z-as) ---
			// Pas zwaartekracht toe als het item in de lucht is of snelheid heeft
			if ((item.z !== undefined && item.z > groundZ) || (item.vz && item.vz !== 0)) {
				item.vz -= 2.0 * delta; // Zwaartekracht
				item.z += item.vz * delta;

				if (item.z < groundZ) {
					item.z = groundZ;
					item.vz *= -0.3; // AANGEPAST: Nog minder hard stuiteren
					if (Math.abs(item.vz) < 2) item.vz = 0; // Stop met stuiteren bij lage snelheid
				}
			}

			// --- Rotatie Logica ---
			if (item.canRotate) {
				item.rotation += item.vr * delta;
				item.vr *= 0.95; // Wrijving op rotatie
			}

			// --- Topple Logica (Omvallen) ---
			if (item.canTopple) {
				item.rotation += item.vr * delta;

				// Zwaartekracht effect: trek naar +/- 90 graden (PI/2) als hij niet rechtop staat
				if (Math.abs(item.rotation) < Math.PI / 2) {
					// Hoe schuiner, hoe sneller hij valt (sinus van de hoek)
					// We voegen een klein beetje 'wiebel' toe als hij bijna recht staat
					item.vr += Math.sin(item.rotation) * 0.02 * delta;
					item.vr *= 0.99; // Luchtweerstand
				} else {
					// Raakt de grond (clamp op 90 graden)
					item.rotation = (Math.sign(item.rotation) * Math.PI) / 2;
					item.vr *= -0.3; // Stuiter een beetje terug
					if (Math.abs(item.vr) < 0.01) item.vr = 0; // Stop met stuiteren
					item.vr *= 0.8; // Wrijving op de grond
				}
			}

			// NIEUW: Check of item significant beweegt of in de lucht is
			const isMoving = item.vx !== 0 || item.vy !== 0 || item.vz !== 0 || item.vr !== 0;
			const isAirborne = (item.z || 0) > getSurfaceHeight(Math.floor(item.x), Math.floor(item.y)) + 0.1;

			// NIEUW: Stuur alleen updates als WIJ de eigenaar zijn (voorkomt fighting/jitter)
			if (item.id && item.lastTouchedBy === mySocketId) {
				if (isMoving || isAirborne) {
					item.isResting = false;
					dirtyItems.push({
						id: item.id,
						x: item.x,
						y: item.y,
						z: item.z || 0,
						vx: item.vx,
						vy: item.vy,
						vz: item.vz || 0,
						rotation: item.rotation || 0,
						vr: item.vr || 0,
						lastTouchedBy: mySocketId,
					});
				} else if (!item.isResting) {
					// Het item is net gestopt: stuur een laatste update met 0 snelheid
					item.isResting = true;
					dirtyItems.push({
						id: item.id,
						x: item.x,
						y: item.y,
						z: item.z || 0,
						vx: 0,
						vy: 0,
						vz: 0,
						rotation: item.rotation || 0,
						vr: 0,
						lastTouchedBy: mySocketId,
					});
				}
			}
		});

		// NIEUW: Stuur updates naar server (max 20 keer per seconde)
		const now = Date.now();
		if (dirtyItems.length > 0 && socket && now - lastPhysicsSync > 50) {
			socket.emit("updateItemPhysics", dirtyItems);
			lastPhysicsSync = now;
		}
	}

	function updateOtherPlayers(delta) {
		const jumpSpeed = 4.5; // Iets sneller dan lokaal (3) om lag in te halen
		const jumpHeight = 12;

		Object.keys(otherPlayers).forEach((id) => {
			const p = otherPlayers[id];
			if (p.moving) {
				p.progress += (jumpSpeed / 60) * delta;

				if (p.progress >= 1) {
					p.progress = 1;
					p.x = p.targetX;
					p.y = p.targetY;
					p.moving = false;
					p.hopOffset = 0;
				} else {
					// Lineaire interpolatie (lerp)
					p.x = p.startX + (p.targetX - p.startX) * p.progress;
					p.y = p.startY + (p.targetY - p.startY) * p.progress;
					// Hop effect
					p.hopOffset = jumpHeight * 4 * p.progress * (1 - p.progress);
				}
			}

			// NIEUW: Laat items ook reageren op andere spelers (visuele interactie)
			items.forEach((item) => {
				if (item === draggedItem) return;

				const dx = item.x - p.x;
				const dy = item.y - p.y;
				const dist = Math.sqrt(dx * dx + dy * dy);
				const minDist = 0.6;

				if (dist < minDist) {
					const pushForce = Math.min(0.15, 0.05 / item.mass);
					const angle = Math.atan2(dy, dx);
					// We passen kracht toe, maar claimen GEEN ownership.
					// De andere speler doet dat in zijn eigen game, wij simuleren het hier voor direct resultaat.
					item.vx += Math.cos(angle) * pushForce;
					item.vy += Math.sin(angle) * pushForce;

					if (item.canRotate) item.vr += (Math.random() - 0.5) * 0.5;
					if (item.canTopple) item.vr += (Math.random() - 0.5) * 0.2;
				}
			});
		});
	}

	function updateBall(delta) {
		// Snelheid van de sprong per seconde
		const jumpSpeed = 3; // 3 tiles per second

		if (!jumping && path.length > 0) {
			// start van midden van tegel horizontaal, onderkant verticaal
			jumpStart = {
				x: Math.floor(ball.x) + 0.5,
				y: Math.floor(ball.y) + 0.5, // onderkant op tegel
			};
			const next = path.shift();
			jumpEnd = {
				x: next.x + 0.5,
				y: next.y + 0.5,
			};
			jumpProgress = 0;
			jumping = true;
		}

		if (jumping) {
			jumpProgress += (jumpSpeed / 60) * delta; // /60 omdat de oude snelheid 0.05 was (1/20)
			if (jumpProgress >= 1) {
				jumpProgress = 1;
				ball.x = jumpEnd.x;
				ball.y = jumpEnd.y;
				jumping = false;
				hopOffset = 0;

				// Sla positie op voor refresh
				const urlParams = new URLSearchParams(window.location.search);
				const roomId = urlParams.get("room") || "default";
				localStorage.setItem(`habboCloneLastPos_${roomId}`, JSON.stringify({ x: ball.x, y: ball.y }));

				// Als het pad leeg is, maak de highlight leeg
				if (path.length === 0) {
					highlightedPath = [];
				}

				if (path.length > 0) {
					jumpStart = { x: ball.x, y: ball.y };
					const next = path.shift();
					jumpEnd = { x: next.x + 0.5, y: next.y + 0.5 };
					jumpProgress = 0;
					jumping = true;

					if (socket) {
						socket.emit("playerMovement", { x: jumpEnd.x, y: jumpEnd.y, isSmoking: isSmoking, smokingItemType: ball.smokingItemType }); // NIEUW: Stuur rookstatus mee bij lopen
					}
				}
			} else {
				// interpolatie
				ball.x = jumpStart.x + (jumpEnd.x - jumpStart.x) * jumpProgress;
				ball.y = jumpStart.y + (jumpEnd.y - jumpStart.y) * jumpProgress;
				hopOffset = jumpHeight * 4 * jumpProgress * (1 - jumpProgress);
			}
		} else hopOffset = 0;

		// Speler-item collision
		items.forEach((item) => {
			// Sla over als het item wordt versleept
			if (item === draggedItem) return;

			const dx = item.x - ball.x;
			const dy = item.y - ball.y;
			const distance = Math.sqrt(dx * dx + dy * dy);
			const minDistance = 0.6; // Hoe dichtbij de speler moet zijn om te duwen

			if (distance < minDistance) {
				// Cap de kracht zodat lichte items (zoals peuken) niet gelanceerd worden
				const pushForce = Math.min(0.15, 0.05 / item.mass);
				const angle = Math.atan2(dy, dx);
				item.lastTouchedBy = mySocketId; // NIEUW: Wij zijn nu de eigenaar omdat we duwen
				item.vx += Math.cos(angle) * pushForce;
				item.vy += Math.sin(angle) * pushForce;

				// Laat ronde items draaien als je ertegenaan loopt
				if (item.canRotate) {
					item.vr += (Math.random() - 0.5) * 0.5; // Geef een willekeurige draai
				}

				// Laat topple items omvallen als je ertegenaan loopt
				if (item.canTopple) {
					item.vr += (Math.random() - 0.5) * 0.2; // Geef een zetje om balans te verstoren
				}
			}
		});

		// --- Check afstand tot open interacties (Winkel / Container) ---
		const shopWindow = document.getElementById("shopWindow");
		const containerWindow = document.getElementById("containerWindow");
		const maxDistance = 1.5; // Maximale afstand in tegels voordat venster sluit

		// Check Winkel
		if (shopWindow.style.display === "flex" && currentOpenShop) {
			const dx = currentOpenShop.x - ball.x;
			const dy = currentOpenShop.y - ball.y;
			// Gebruik manhattan distance of euclidische afstand naar de rand van het object
			// Simpele check: afstand tot het midden van het object
			const dist = Math.sqrt(dx * dx + dy * dy);
			if (dist > maxDistance + 1) {
				// +1 marge voor de grootte van het object
				document.getElementById("closeShopBtn").click(); // Gebruik de sluit-knop logica
			}
		}

		// Check Container
		if (containerWindow.style.display === "flex" && openContainer) {
			const dx = openContainer.x - ball.x;
			const dy = openContainer.y - ball.y;
			const dist = Math.sqrt(dx * dx + dy * dy);
			if (dist > maxDistance + 1) {
				document.getElementById("closeContainerBtn").click(); // Gebruik de sluit-knop logica
			}
		}
	}

	let isDraggingChat = false;
	let dragStartChat = { x: 0, y: 0 };
	let chatStartPos = { x: 0, y: 0 };

	chatLog.addEventListener("mousedown", (e) => {
		bringToFront(chatLog);
		isDraggingChat = true;
		dragStartChat = { x: e.clientX, y: e.clientY };

		// Voorkom dat de canvas een 'mousedown' event ontvangt als we op een UI-element klikken
		if (e.target.closest("#chatLog")) {
			e.stopPropagation();
		}

		const rect = chatLog.getBoundingClientRect();
		chatStartPos = { x: rect.left, y: rect.top };
		e.preventDefault();
	});

	window.addEventListener("mousemove", (e) => {
		if (!isDraggingChat) return;

		const dx = e.clientX - dragStartChat.x;
		const dy = e.clientY - dragStartChat.y;

		const newX = chatStartPos.x + dx;
		const newY = chatStartPos.y + dy;

		const rect = chatLog.getBoundingClientRect();

		const minX = 0;
		const minY = 0;
		const maxX = window.innerWidth - rect.width;
		const maxY = window.innerHeight - rect.height - 50;

		chatLog.style.left = Math.max(minX, Math.min(newX, maxX)) + "px";
		chatLog.style.top = Math.max(minY, Math.min(newY, maxY)) + "px";
	});

	buildMenu.addEventListener("mousedown", (e) => {
		// Alleen slepen als we op de header klikken
		if (!e.composedPath().includes(document.getElementById("buildMenuHeader"))) return;
		bringToFront(buildMenu);

		// Voorkom dat de canvas een 'mousedown' event ontvangt als we op een UI-element klikken
		if (e.target.closest("#buildMenu")) {
			e.stopPropagation();
		}

		isDraggingBuild = true;
		dragStartBuild = { x: e.clientX, y: e.clientY };
		const rect = buildMenu.getBoundingClientRect();
		buildStartPos = { x: rect.left, y: rect.top };
		e.preventDefault();
	});

	window.addEventListener("mousemove", (e) => {
		if (!isDraggingBuild) return;

		const dx = e.clientX - dragStartBuild.x;
		const dy = e.clientY - dragStartBuild.y;

		const newX = Math.max(0, Math.min(buildStartPos.x + dx, window.innerWidth - buildMenu.offsetWidth));
		const newY = Math.max(0, Math.min(buildStartPos.y + dy, window.innerHeight - buildMenu.offsetHeight - 50));

		buildMenu.style.left = newX + "px";
		buildMenu.style.top = newY + "px";
	});

	inventory.addEventListener("mousedown", (e) => {
		// Alleen slepen als we op de header klikken
		if (!e.composedPath().includes(document.getElementById("inventoryHeader"))) return;
		bringToFront(inventory);

		// Voorkom dat de canvas een 'mousedown' event ontvangt als we op een UI-element klikken
		if (e.target.closest("#inventory")) {
			e.stopPropagation();
		}

		isDraggingInventory = true;
		dragStartInventory = { x: e.clientX, y: e.clientY };
		const rect = inventory.getBoundingClientRect();
		inventoryStartPos = { x: rect.left, y: rect.top };
		e.preventDefault();
	});

	window.addEventListener("mousemove", (e) => {
		if (!isDraggingInventory) return;

		const dx = e.clientX - dragStartInventory.x;
		const dy = e.clientY - dragStartInventory.y;

		const newX = Math.max(0, Math.min(inventoryStartPos.x + dx, window.innerWidth - inventory.offsetWidth));
		const newY = Math.max(0, Math.min(inventoryStartPos.y + dy, window.innerHeight - inventory.offsetHeight - 50));

		inventory.style.left = newX + "px";
		inventory.style.top = newY + "px";
	});

	// Sleep logica voor container header
	const containerWindow = document.getElementById("containerWindow");
	const containerHeader = document.getElementById("containerHeader");
	let isDraggingContainer = false;
	let dragStartContainer = { x: 0, y: 0 };
	let containerStartPos = { x: 0, y: 0 };

	containerHeader.addEventListener("mousedown", (e) => {
		bringToFront(containerWindow);
		isDraggingContainer = true;
		dragStartContainer = { x: e.clientX, y: e.clientY };
		const rect = containerWindow.getBoundingClientRect();
		containerWindow.style.left = rect.left + "px";
		containerWindow.style.top = rect.top + "px";
		containerStartPos = { x: rect.left, y: rect.top };
		e.preventDefault();
	});

	window.addEventListener("mousemove", (e) => {
		if (!isDraggingContainer) return;

		const dx = e.clientX - dragStartContainer.x;
		const dy = e.clientY - dragStartContainer.y;
		const newX = Math.max(0, Math.min(containerStartPos.x + dx, window.innerWidth - containerWindow.offsetWidth));
		const newY = Math.max(0, Math.min(containerStartPos.y + dy, window.innerHeight - containerWindow.offsetHeight - 50));
		containerWindow.style.left = newX + "px";
		containerWindow.style.top = newY + "px";
	});

	// Sleep logica voor pouch header
	const pouchHeader = document.getElementById("pouchHeader");
	let isDraggingPouch = false;
	let dragStartPouch = { x: 0, y: 0 };
	let pouchStartPos = { x: 0, y: 0 };

	if (pouchHeader) {
		pouchHeader.addEventListener("mousedown", (e) => {
			bringToFront(pouchWindow);
			isDraggingPouch = true;
			dragStartPouch = { x: e.clientX, y: e.clientY };
			const rect = pouchWindow.getBoundingClientRect();
			pouchWindow.style.left = rect.left + "px";
			pouchWindow.style.top = rect.top + "px";
			pouchStartPos = { x: rect.left, y: rect.top };
			e.preventDefault();
		});
	}

	window.addEventListener("mousemove", (e) => {
		if (!isDraggingPouch) return;

		const dx = e.clientX - dragStartPouch.x;
		const dy = e.clientY - dragStartPouch.y;
		const newX = Math.max(0, Math.min(pouchStartPos.x + dx, window.innerWidth - pouchWindow.offsetWidth));
		const newY = Math.max(0, Math.min(pouchStartPos.y + dy, window.innerHeight - pouchWindow.offsetHeight - 50));
		pouchWindow.style.left = newX + "px";
		pouchWindow.style.top = newY + "px";
	});

	// Sleep logica voor rooms header
	const roomsHeader = document.getElementById("roomsHeader");
	let isDraggingRooms = false;
	let dragStartRooms = { x: 0, y: 0 };
	let roomsStartPos = { x: 0, y: 0 };

	if (roomsHeader) {
		roomsHeader.addEventListener("mousedown", (e) => {
			bringToFront(roomsWindow);
			isDraggingRooms = true;
			dragStartRooms = { x: e.clientX, y: e.clientY };
			const rect = roomsWindow.getBoundingClientRect();
			roomsWindow.style.transform = "none";
			roomsWindow.style.left = rect.left + "px";
			roomsWindow.style.top = rect.top + "px";
			roomsStartPos = { x: rect.left, y: rect.top };
		});
	}

	window.addEventListener("mousemove", (e) => {
		if (!isDraggingRooms) return;
		const dx = e.clientX - dragStartRooms.x;
		const dy = e.clientY - dragStartRooms.y;
		const newX = Math.max(0, Math.min(roomsStartPos.x + dx, window.innerWidth - roomsWindow.offsetWidth));
		const newY = Math.max(0, Math.min(roomsStartPos.y + dy, window.innerHeight - roomsWindow.offsetHeight - 50));
		roomsWindow.style.left = newX + "px";
		roomsWindow.style.top = newY + "px";
	});

	window.addEventListener("mouseup", (e) => {
		// Stop met het slepen van UI-elementen
		isDraggingChat = false;
		isDraggingBuild = false;
		isDraggingInventory = false;
		isDraggingPong = false; // Stop pong slepen
		isDraggingShop = false;
		isDraggingContainer = false;
		isDraggingRooms = false;
		isDraggingPouch = false;
		isDraggingMyRoom = false;
		isDraggingRoomPlayers = false;
		isDraggingFriends = false;
		isDraggingPaper = false;
		isDraggingNewProject = false;

		// Stop met het slepen van de camera (rechtermuisknop)
		if (e.button === 2) {
			isCameraDragging = false;
		}

		// Handel het loslaten van een gesleept object af, ongeacht waar de muis is
		if (isObjectDragging && e.button === 0) {
			// Alleen voor linkermuisknop
			const { x, y } = toTile(e.clientX, e.clientY);
			const playerOnTile = Math.floor(ball.x) === x && Math.floor(ball.y) === y;

			// Check geldigheid (rekening houdend met width/depth)
			const w = draggedObject.flipped ? draggedObject.depth || 1 : draggedObject.width || 1;
			const d = draggedObject.flipped ? draggedObject.width || 1 : draggedObject.depth || 1;
			let isValidPlacement = true;
			for (let dx = 0; dx < w; dx++) {
				for (let dy = 0; dy < d; dy++) {
					const tx = x + dx;
					const ty = y + dy;
					if (tx >= mapW || ty >= mapH || isBlocked(tx, ty, true) || (Math.floor(ball.x) === tx && Math.floor(ball.y) === ty))
						isValidPlacement = false;
				}
			}

			if (isValidPlacement) {
				draggedObject.x = x;
				draggedObject.y = y;
			} else {
				// Plaats terug op de originele positie als de nieuwe plek ongeldig is
				draggedObject.x = draggedObjectOriginalPos.x;
				draggedObject.y = draggedObjectOriginalPos.y;
			}
			const { runtimeImage, ...objectToSend } = draggedObject;
			socket.emit("placeObject", objectToSend);

			// Reset alle sleep-gerelateerde variabelen
			draggedObject = null;
			draggedObjectOriginalPos = null;
			isObjectDragging = false;
			movePreview.style.display = "none";

			// Start het soepel terugkeren van de camera als deze was meebewogen
			if (camOriginalPos) {
				camTargetX = camOriginalPos.x;
				camTargetY = camOriginalPos.y;
				camSmooth = true;
				camOriginalPos = null;
			}

			// Heropen de vensters die open stonden
			if (windowStatesBeforeDrag) {
				if (windowStatesBeforeDrag.chat) document.getElementById("chatLog").style.display = windowStatesBeforeDrag.chat;
				if (windowStatesBeforeDrag.inventory) document.getElementById("inventory").style.display = windowStatesBeforeDrag.inventory;
				// Voor het bouwmenu moeten we de 'isBuildMode' vlag correct zetten
				if (windowStatesBeforeDrag.build === "flex") {
					buildBtn.click(); // Simuleer een klik om de bouwmodus correct te heractiveren
				}
				if (windowStatesBeforeDrag.pouch === "flex") {
					buildBtn.click(); // Simuleer een klik om de bouwmodus correct te heractiveren
				}
				if (windowStatesBeforeDrag.paper === "flex") {
					document.getElementById("paperWindow").style.display = "flex";
				}
				if (windowStatesBeforeDrag.newProject === "flex") {
					document.getElementById("newProjectWindow").style.display = "flex";
				}
				windowStatesBeforeDrag = null; // Reset de opgeslagen staat
			}
			return; // Belangrijk: stop verdere uitvoering om te voorkomen dat de speler gaat lopen.
		}

		// Stop camera slepen met rechtermuisknop
		if (isCameraDragging && e.button === 2) {
			isCameraDragging = false;
		}

		// NIEUW: Commit stroke naar undo stack bij loslaten muis
		if (currentStroke.length > 0) {
			undoStack.push([...currentStroke]);
			currentStroke = [];
		}
	});

	window.addEventListener("mousemove", (e) => {
		// --- Logica voor verplaatsen BINNEN pouch ---
		if (isRearrangingContainer && activePouchItem) {
			const rect = pouchWindow.getBoundingClientRect();

			// Check of de muis BUITEN de pouch komt -> Switch naar wereld-sleep
			if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
				isRearrangingContainer = false;

				const index = openPouch.items.indexOf(activePouchItem);
				if (index > -1) openPouch.items.splice(index, 1);
				renderPouchItems();
				savePlayerData();

				draggedItem = activePouchItem;
				isItemDragging = true;
				isDraggingFromContainer = true; // Hergebruik vlag
				isDraggingFromInventory = false;
				isDraggingFromShop = false;
				draggedItemOriginalPos = null;

				dragImageElement = document.createElement("img");
				dragImageElement.src = draggedItem.image.src;
				dragImageElement.style.position = "absolute";
				dragImageElement.style.pointerEvents = "none";
				dragImageElement.style.zIndex = "9999";
				dragImageElement.style.imageRendering = "pixelated";
				const w = (draggedItem.image.width || 64) * scale;
				const h = (draggedItem.image.height || 64) * scale;
				dragImageElement.style.width = w + "px";
				dragImageElement.style.left = e.clientX - w / 2 + "px";
				dragImageElement.style.top = e.clientY - h / 2 + "px";
				document.body.appendChild(dragImageElement);

				activePouchItem = null;
				return;
			}

			const contentRect = document.getElementById("pouchContent").getBoundingClientRect();
			activePouchItem.conX = e.clientX - contentRect.left - containerDragOffset.x;
			activePouchItem.conY = e.clientY - contentRect.top - containerDragOffset.y;
			renderPouchItems();
		}

		// NIEUW: Check voor pending pickup beweging
		// Als we wachten op pickup (muis ingedrukt op item) en we bewegen de muis significant,
		// start dan direct het slepen (drag & drop gedrag).
		if (pendingPickup) {
			const dist = Math.sqrt(Math.pow(e.clientX - pendingPickup.x, 2) + Math.pow(e.clientY - pendingPickup.y, 2));
			if (dist > 5) {
				// 5 pixels drempel
				performItemPickup(pendingPickup.item, e.clientX, e.clientY);
			}
		}
	});

	// --- Sleep Logica voor Pong Game ---
	const pongGame = document.getElementById("pongGame");
	const pongHeader = document.getElementById("pongHeader");
	let isDraggingPong = false;
	let dragStartPong = { x: 0, y: 0 };
	let pongStartPos = { x: 0, y: 0 };

	pongHeader.addEventListener("mousedown", (e) => {
		if (pongRunning) return; // Niet slepen tijdens het spelen
		if (e.target.closest(".close-btn")) return; // Niet slepen als we op sluiten klikken

		isDraggingPong = true;
		dragStartPong = { x: e.clientX, y: e.clientY };

		// Omdat pongGame standaard gecentreerd is met transform, moeten we dit omzetten naar absolute posities
		// bij de eerste keer slepen, anders verspringt hij.
		const rect = pongGame.getBoundingClientRect();
		pongGame.style.transform = "none"; // Verwijder de centrering
		pongGame.style.left = rect.left + "px";
		pongGame.style.top = rect.top + "px";

		pongStartPos = { x: rect.left, y: rect.top };
		e.preventDefault();
	});

	window.addEventListener("mousemove", (e) => {
		if (!isDraggingPong) return;

		const dx = e.clientX - dragStartPong.x;
		const dy = e.clientY - dragStartPong.y;

		const newX = Math.max(0, Math.min(pongStartPos.x + dx, window.innerWidth - pongGame.offsetWidth));
		const newY = Math.max(0, Math.min(pongStartPos.y + dy, window.innerHeight - pongGame.offsetHeight - 50));

		pongGame.style.left = newX + "px";
		pongGame.style.top = newY + "px";
	});

	// Sleep logica voor marker menu
	const markerMenuHeader = document.getElementById("markerMenuHeader");
	let isDraggingMarker = false;
	let dragStartMarker = { x: 0, y: 0 };
	let markerStartPos = { x: 0, y: 0 };

	if (markerMenuHeader) {
		markerMenuHeader.addEventListener("mousedown", (e) => {
			bringToFront(markerMenu);
			isDraggingMarker = true;
			dragStartMarker = { x: e.clientX, y: e.clientY };
			const rect = markerMenu.getBoundingClientRect();
			markerMenu.style.left = rect.left + "px";
			markerMenu.style.top = rect.top + "px";
			markerStartPos = { x: rect.left, y: rect.top };
			e.preventDefault();
		});
	}

	window.addEventListener("mousemove", (e) => {
		if (!isDraggingMarker) return;
		const dx = e.clientX - dragStartMarker.x;
		const dy = e.clientY - dragStartMarker.y;
		const newX = Math.max(0, Math.min(markerStartPos.x + dx, window.innerWidth - markerMenu.offsetWidth));
		const newY = Math.max(0, Math.min(markerStartPos.y + dy, window.innerHeight - markerMenu.offsetHeight - 50));
		markerMenu.style.left = newX + "px";
		markerMenu.style.top = newY + "px";
	});

	window.addEventListener("mouseup", () => {
		isDraggingMarker = false;
	});

	// Initieel renderen van de bouw-items (ook al is het menu verborgen)
	renderBuildItems();

	// Initieel renderen van Paper projecten
	renderPaperProjects();

	setInterval(() => {
		const now = Date.now();
		const currentId = socket ? socket.id || mySocketId : "local";
		const myActiveMessages = chatMessages
			.filter((m) => {
				const isMe = (m.userId && m.userId === myUserId) || (!m.userId && (m.id === currentId || m.id === "local"));
				return isMe && now - m.time < m.duration;
			})
			.sort((a, b) => a.time - b.time);

		if (myActiveMessages.length >= 5) {
			const oldest = myActiveMessages[0];
			const remaining = Math.max(0, Math.ceil((oldest.duration - (now - oldest.time)) / 1000));

			chatInput.disabled = true;
			chatInput.value = "";
			chatInput.placeholder = `Even wachten (${remaining}s)`;
		} else {
			chatInput.disabled = false;
			chatInput.placeholder = "Typ hier je bericht...";
			chatInput.style.color = "#000";
		}
	}, 250);

	let lastPuddleSyncTime = 0;
	let lastSnowSyncTime = 0;

	function updateWeatherEffects(delta) {
		const weather = currentRoomSettings.weather;
		const isRaining = currentRoomSettings.isOutside && weather === "rain";
		const isSnowing = currentRoomSettings.isOutside && weather === "snow";

		// Bepaal of wij de simulatie draaien (Eigenaar of Host in publieke kamer)
		const allIds = Object.keys(otherPlayers).concat([mySocketId]);
		allIds.sort();
		const isHost = allIds[0] === mySocketId;
		const shouldSimulate = isRoomOwner || (!currentRoomSettings.ownerId && isHost);

		if (shouldSimulate) {
			// --- SNEEUW LOGICA ---
			if (isSnowing) {
				// Sneeuw bouwt op
				for (let i = 0; i < 3; i++) {
					const rx = Math.floor(Math.random() * (mapW - 2)) + 1;
					const ry = Math.floor(Math.random() * (mapH - 2)) + 1;
					const key = `${rx},${ry}`;
					if (!isBlocked(rx, ry)) {
						if (!tileSnow[key]) tileSnow[key] = 0;
						if (tileSnow[key] < 1) tileSnow[key] += 0.005 * delta; // Sneeuw groeit langzamer
					}
				}
			} else {
				// Sneeuw smelt (Dooien) -> Wordt water
				for (const key in tileSnow) {
					const meltRate = 0.002 * delta;
					tileSnow[key] -= meltRate;

					// Smeltwater wordt toegevoegd aan puddles
					if (!tilePuddles[key]) tilePuddles[key] = 0;
					tilePuddles[key] += meltRate;
					if (tilePuddles[key] > 1) tilePuddles[key] = 1;

					if (tileSnow[key] <= 0) delete tileSnow[key];
				}
			}

			// --- REGEN LOGICA ---
			if (isRaining) {
				// Plassen groeien door regen
				for (let i = 0; i < 5; i++) {
					const rx = Math.floor(Math.random() * (mapW - 2)) + 1;
					const ry = Math.floor(Math.random() * (mapH - 2)) + 1;
					const key = `${rx},${ry}`;

					// Gebruik deterministische random om te bepalen of hier een plas kan vormen (kuil in de weg)
					// Alleen tegels met een waarde > 0.65 krijgen een plas (ca. 35% van de tegels)
					if (randomDeterministic(rx, ry) > 0.65 && !isBlocked(rx, ry)) {
						if (!tilePuddles[key]) tilePuddles[key] = 0;
						if (tilePuddles[key] < 1) tilePuddles[key] += 0.01 * delta;
					}
				}
			} else {
				// Plassen drogen op (als het niet regent)
				for (const key in tilePuddles) {
					tilePuddles[key] -= 0.001 * delta;
					if (tilePuddles[key] <= 0) delete tilePuddles[key];
				}
			}

			// Sync naar server (elke seconde, throttled)
			const now = Date.now();
			if (now - lastPuddleSyncTime > 1000) {
				socket.emit("syncPuddles", tilePuddles);
				socket.emit("syncSnow", tileSnow); // Ook sneeuw syncen
				lastPuddleSyncTime = now;
			}
		}

		// Spetters zijn visueel en lokaal, die mag iedereen zien/genereren
		if (isRaining) {
			if (activeSplashes.length < 50) {
				const count = Math.random() < 0.5 ? 0 : 1;
				for (let i = 0; i < count; i++) {
					const rx = Math.random() * (mapW - 2) + 1;
					const ry = Math.random() * (mapH - 2) + 1;
					if (!isBlocked(Math.floor(rx), Math.floor(ry))) {
						activeSplashes.push({ x: rx, y: ry, startTime: Date.now() });
					}
				}
			}
		}

		const now = Date.now();
		activeSplashes = activeSplashes.filter((s) => now - s.startTime < 300);
	}

	// NIEUW: Update marker strepen (fade out)
	function updateMarks(delta) {
		for (let i = activeMarks.length - 1; i >= 0; i--) {
			const rate = activeMarks[i].decayRate !== undefined ? activeMarks[i].decayRate : 0.005;
			activeMarks[i].life -= rate * delta; // Fade out snelheid
			if (activeMarks[i].life <= 0) {
				activeMarks.splice(i, 1);
			}
		}
	}

	// NIEUW: Aparte loop voor spellogica (blijft draaien in achtergrond via setInterval)
	function gameLogic() {
		const now = Date.now();
		const deltaTime = now - lastLogicTime;
		lastLogicTime = now;

		const delta = deltaTime / (1000 / 60); // delta is ~1.0 bij 60fps

		updateItems(delta);
		updateBall(delta);
		updateOtherPlayers(delta);
		updateCamera(delta);
		updateWeatherEffects(delta);
		updateMarks(delta); // NIEUW: Update marker sporen

		// Camera pan tijdens slepen van object (verplaatst uit renderLoop)
		if (isObjectDragging) {
			const panZone = 100;
			const panSpeed = 5 * delta;

			if (mousePos.x < panZone) camX += panSpeed;
			if (mousePos.x > window.innerWidth - panZone) camX -= panSpeed;
			if (mousePos.y < panZone) camY += panSpeed;
			if (mousePos.y > window.innerHeight - panZone) camY -= panSpeed;

			if (camOriginalPos) {
				camOriginalPos.x = camX;
				camOriginalPos.y = camY;
			}
		}
	}

	// Start de logic loop op ~60fps
	setInterval(gameLogic, 1000 / 60);

	let weatherParticles = [];
	// NIEUW: State variabelen voor soepele transities
	let curTimeOverlay = { r: 0, g: 0, b: 0, a: 0 };
	let curWeatherOverlay = { r: 0, g: 0, b: 0, a: 0 };
	let curSkyColor = { r: 135, g: 206, b: 235, a: 1 }; // Default dag blauw
	let curHorizonColor = { r: 34, g: 34, b: 34, a: 1 }; // Default horizon grijs
	let curGroundColor = { r: 34, g: 34, b: 34, a: 1 }; // Default grond grijs

	// Helper voor lineaire interpolatie
	function lerp(start, end, t) {
		return start + (end - start) * t;
	}

	// Helper voor kleur interpolatie
	function lerpColor(current, target, speed) {
		return {
			r: lerp(current.r, target.r, speed),
			g: lerp(current.g, target.g, speed),
			b: lerp(current.b, target.b, speed),
			a: lerp(current.a !== undefined ? current.a : 1, target.a !== undefined ? target.a : 1, speed),
		};
	}

	function updateAndDrawWeather(ctx, width, height) {
		const weather = currentRoomSettings.weather || "clear";
		const time = currentRoomSettings.time || "day";
		const isOutside = currentRoomSettings.isOutside;

		// 1. Particle logica (alleen als we buiten zijn)
		if (!isOutside) {
			weatherParticles = [];
		} else {
			// Spawn particles
			if (weatherParticles.length < 200 && (weather === "rain" || weather === "snow")) {
				let spawnX = Math.random() * width;
				let spawnY = -10;

				if (weather === "rain") spawnX = Math.random() * (width + 300); // Breder spawnen voor schuine regen

				weatherParticles.push({
					x: spawnX,
					y: spawnY,
					speed: Math.random() * 5 + 5,
					type: weather,
				});
			}
		}

		// 2. Bepaal doelkleuren voor overlays
		let targetTime = { r: 0, g: 0, b: 0, a: 0 };
		let targetWeather = { r: 0, g: 0, b: 0, a: 0 };

		if (isOutside) {
			if (time === "night") targetTime = { r: 0, g: 0, b: 20, a: 0.6 };
			else if (time === "sunrise") targetTime = { r: 255, g: 150, b: 50, a: 0.2 };
			else if (time === "sunset") targetTime = { r: 200, g: 50, b: 50, a: 0.3 };

			if (weather === "mist") targetWeather = { r: 255, g: 255, b: 255, a: 0.4 };
			else if (weather === "sun" && time === "day") targetWeather = { r: 255, g: 220, b: 150, a: 0.25 };
		}

		// 3. Interpoleer huidige kleur naar doelkleur (Smooth Transition)
		const speed = 0.01; // Snelheid van de transitie (lager = trager/vloeiender)
		curTimeOverlay = lerpColor(curTimeOverlay, targetTime, speed);
		curWeatherOverlay = lerpColor(curWeatherOverlay, targetWeather, speed);

		// 4. Teken overlays
		if (curTimeOverlay.a > 0.005) {
			ctx.fillStyle = `rgba(${Math.round(curTimeOverlay.r)}, ${Math.round(curTimeOverlay.g)}, ${Math.round(curTimeOverlay.b)}, ${
				curTimeOverlay.a
			})`;
			ctx.fillRect(0, 0, width, height);
		}
		if (curWeatherOverlay.a > 0.005) {
			ctx.fillStyle = `rgba(${Math.round(curWeatherOverlay.r)}, ${Math.round(curWeatherOverlay.g)}, ${Math.round(curWeatherOverlay.b)}, ${
				curWeatherOverlay.a
			})`;
			ctx.fillRect(0, 0, width, height);
		}

		// Teken particles (Regen, Sneeuw)
		if (weather === "rain" || weather === "snow") {
			ctx.strokeStyle = "rgba(174, 194, 224, 0.5)";
			ctx.fillStyle = "white";
			ctx.lineWidth = 1;

			for (let i = 0; i < weatherParticles.length; i++) {
				const p = weatherParticles[i];

				if (weather === "rain") {
					p.y += p.speed;
					p.x -= 2; // Schuin naar links

					ctx.beginPath();
					ctx.moveTo(p.x, p.y);
					ctx.lineTo(p.x - 2, p.y + 10); // Schuine streep
					ctx.stroke();
				} else if (weather === "snow") {
					p.y += p.speed * 0.2; // Sneeuw valt trager (was 0.6)
					// Pixelated sneeuw (vierkantjes)
					ctx.fillRect(p.x, p.y, 2, 2);
				}

				// Kill particles die buiten beeld vallen
				if (p.y > height) {
					weatherParticles.splice(i, 1);
					i--;
				}
			}
		}
	}

	function drawSkybox() {
		if (!currentRoomSettings.isOutside) {
			return;
		}

		const weather = currentRoomSettings.weather || "clear";
		const time = currentRoomSettings.time || "day";

		// Bepaal doelkleuren voor lucht en horizon
		let targetSky = { r: 135, g: 206, b: 235 }; // Default dag
		let targetHorizon = { r: 160, g: 215, b: 245 }; // Default horizon (Iets donkerder dan grond voor verloop)
		let targetGround = { r: 34, g: 34, b: 34 }; // Default grond grijs

		if (time === "night") {
			targetSky = { r: 10, g: 10, b: 30 };
			targetHorizon = { r: 34, g: 34, b: 34 };
			targetGround = { r: 34, g: 34, b: 34 };
		} else if (weather === "rain") {
			targetSky = { r: 50, g: 50, b: 70 };
			targetHorizon = { r: 34, g: 34, b: 34 };
			targetGround = { r: 34, g: 34, b: 34 };
		} else if (weather === "snow" || weather === "mist") {
			targetSky = { r: 200, g: 200, b: 210 };
			targetHorizon = { r: 200, g: 200, b: 210 };
			targetGround = { r: 34, g: 34, b: 34 };
		} else if (time === "sunrise") {
			targetSky = { r: 255, g: 200, b: 120 };
			targetHorizon = { r: 255, g: 170, b: 0 }; // Oranje horizon
			targetGround = { r: 34, g: 34, b: 34 }; // Grijs aan de grond
		} else if (time === "sunset") {
			targetSky = { r: 180, g: 80, b: 100 };
			targetHorizon = { r: 255, g: 68, b: 0 }; // Rood/Oranje horizon
			targetGround = { r: 34, g: 34, b: 34 }; // Grijs aan de grond
		} else if (weather === "sun" && time === "day") {
			targetSky = { r: 255, g: 200, b: 100 };
			targetHorizon = { r: 255, g: 210, b: 125 }; // Iets donkerder voor verloop
			targetGround = { r: 34, g: 34, b: 34 }; // Grijs aan de grond
		}

		// Interpoleer kleuren
		const speed = 0.01;
		curSkyColor = lerpColor(curSkyColor, targetSky, speed);
		curHorizonColor = lerpColor(curHorizonColor, targetHorizon, speed);
		curGroundColor = lerpColor(curGroundColor, targetGround, speed);

		ctx.save();
		// GEEN reset transform, we tekenen in de wereld!

		// Bereken het ankerpunt (Tile 0,0 - de hoek van de muren)
		const anchor = toScreen(0, 0);

		// Maak een gradient die start bij de vloer (anchor.sy) en omhoog gaat
		// We tekenen een grote rechthoek die meebeweegt met de wereld
		const skyHeight = 2000; // Hoog genoeg om het scherm te vullen
		const skyWidth = 4000; // Breed genoeg

		const gradient = ctx.createLinearGradient(0, anchor.sy, 0, anchor.sy - skyHeight);

		// Gebruik geïnterpoleerde kleuren
		gradient.addColorStop(0, `rgb(${Math.round(curGroundColor.r)},${Math.round(curGroundColor.g)},${Math.round(curGroundColor.b)})`);
		gradient.addColorStop(0.1, `rgb(${Math.round(curHorizonColor.r)},${Math.round(curHorizonColor.g)},${Math.round(curHorizonColor.b)})`);
		gradient.addColorStop(0.3, `rgb(${Math.round(curSkyColor.r)},${Math.round(curSkyColor.g)},${Math.round(curSkyColor.b)})`);

		ctx.fillStyle = gradient;

		// Teken de lucht achter de muren (vanaf -2000 tot +2000 breedte)
		ctx.fillRect(anchor.sx - skyWidth / 2, anchor.sy - skyHeight, skyWidth, skyHeight);

		ctx.restore();
	}

	function renderLoop() {
		// Reset transform naar fysieke pixels (inclusief DPR)
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.imageSmoothingEnabled = false; // Standaard voor de hele frame: scherpe pixels

		// Clear het hele scherm (gebruik logische coordinaten omdat dpr in transform zit)
		ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

		ctx.setTransform(scale * dpr, 0, 0, scale * dpr, (window.innerWidth / 2 + camX) * dpr, (window.innerHeight / 4 + camY) * dpr);

		// NIEUW: Teken skybox als we buiten zijn (NU IN WERELD SPACE)
		drawSkybox();

		drawTiles();
		drawTopWall();
		drawLeftWall();
		drawFloorThickness(); // NIEUW: Teken de vloerrand
		drawFreeWallObjects(); // NIEUW: Teken vrije muurobjecten op de voorgrond

		// --- Dieptegesorteerde renderlijst ---
		const renderList = [];

		// 1. Path Highlight
		if (highlightedPath.length > 0) {
			highlightedPath.forEach((tile) => {
				renderList.push({
					type: "highlight",
					sortKey: tile.x + tile.y - 0.05, // Boven vloer (-0.1), onder objecten
					draw: () => {
						const { sx, sy } = toScreen(tile.x, tile.y);
						ctx.beginPath();
						ctx.moveTo(sx, sy);
						ctx.lineTo(sx + tileW / 2, sy + tileH / 2);
						ctx.lineTo(sx, sy + tileH);
						ctx.lineTo(sx - tileW / 2, sy + tileH / 2);
						ctx.closePath();
						ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
						ctx.fill();
					},
				});
			});
		}

		// Puddles (Regenplassen) - Toegevoegd aan renderList voor correcte z-index (boven vloeren)
		for (const key in tilePuddles) {
			const puddle = tilePuddles[key];
			if (puddle > 0.05) {
				const [tx, ty] = key.split(",").map(Number);
				renderList.push({
					type: "puddle",
					sortKey: tx + ty - 0.06, // Boven vloer (-0.1), onder highlights (-0.05)
					draw: () => {
						const { sx, sy } = toScreen(tx, ty);
						ctx.save();
						ctx.translate(sx, sy + tileH / 2);
						ctx.scale(1, 0.5);

						// Pixel Art Puddle
						const size = (tileW / 2) * 0.8 * Math.sqrt(puddle);
						const pixelSize = 4; // Grootte van de 'pixels'
						const seed = randomDeterministic(tx, ty);

						ctx.fillStyle = `rgba(100, 120, 160, ${0.6 * puddle})`;

						for (let py = -size; py <= size; py += pixelSize) {
							// Bereken breedte op deze hoogte (cirkel formule)
							const chord = Math.sqrt(Math.max(0, size * size - py * py));
							// Voeg ruis toe aan de breedte en positie voor een grillige vorm
							const noise = Math.sin(py * 0.5 + seed * 10) * (size * 0.3);
							const w = Math.max(0, (chord + noise) * 2);
							const xOffset = Math.cos(py * 0.1 + seed * 5) * (size * 0.2);

							if (w > 0) ctx.fillRect(xOffset - w / 2, py, w, pixelSize);
						}
						ctx.restore();
					},
				});
			}
		}

		// Snow (Sneeuwlaag) - Teken BOVEN puddles
		for (const key in tileSnow) {
			const snowAmount = tileSnow[key];
			if (snowAmount > 0.05) {
				const [tx, ty] = key.split(",").map(Number);
				renderList.push({
					type: "snow",
					sortKey: tx + ty - 0.055, // Iets boven puddles (-0.06)
					draw: () => {
						const { sx, sy } = toScreen(tx, ty);
						ctx.save();
						ctx.translate(sx, sy + tileH / 2);
						ctx.scale(1, 0.5);

						// Pixel Art Snow (Wit, iets groter dan puddle)
						const size = (tileW / 2) * 0.9 * Math.sqrt(snowAmount);
						const pixelSize = 4;
						const seed = randomDeterministic(tx, ty) + 0.5; // Andere seed dan puddle

						ctx.fillStyle = `rgba(240, 245, 255, ${0.9 * snowAmount})`; // Bijna wit

						for (let py = -size; py <= size; py += pixelSize) {
							const chord = Math.sqrt(Math.max(0, size * size - py * py));
							const noise = Math.sin(py * 0.4 + seed * 10) * (size * 0.2); // Iets zachtere ruis
							const w = Math.max(0, (chord + noise) * 2);
							const xOffset = Math.cos(py * 0.15 + seed * 5) * (size * 0.15);

							if (w > 0) ctx.fillRect(xOffset - w / 2, py, w, pixelSize);
						}
						ctx.restore();
					},
				});
			}
		}

		// Splashes (Regenspetters)
		activeSplashes.forEach((s) => {
			const tx = Math.floor(s.x);
			const ty = Math.floor(s.y);
			renderList.push({
				type: "splash",
				sortKey: tx + ty - 0.04, // Boven puddles
				draw: () => {
					const { sx, sy } = toScreen(s.x, s.y);
					const age = Date.now() - s.startTime;
					const progress = age / 300;
					if (progress > 1) return;
					const centerY = sy + tileH / 2;
					ctx.save();

					// Pixel Art Splash (Ripple)
					ctx.fillStyle = `rgba(200, 220, 255, ${1 - progress})`;
					const dist = 12 * progress;
					const pSize = 2;

					// 4 uitdijende pixels
					ctx.fillRect(sx - pSize / 2, centerY - dist * 0.5, pSize, pSize);
					ctx.fillRect(sx - pSize / 2, centerY + dist * 0.5, pSize, pSize);
					ctx.fillRect(sx - dist, centerY - pSize / 2, pSize, pSize);
					ctx.fillRect(sx + dist, centerY - pSize / 2, pSize, pSize);

					if (progress < 0.6) {
						const dropH = 15 * Math.sin(progress * Math.PI);
						ctx.fillRect(sx - 1, centerY - dropH, 2, 2);
						ctx.fillRect(sx - 5, centerY - dropH * 0.7, 2, 2);
						ctx.fillRect(sx + 4, centerY - dropH * 0.7, 2, 2);
					}
					ctx.restore();
				},
			});
		});

		// 2. Hover Highlight
		let hoverTile = null;
		if (isBuildMode && activeBuildCategory === "kleur" && hoverTarget && hoverTarget.type === "tile") {
			hoverTile = hoverTarget.id;
		} else if (hoverCell && !isBuildMode && !isItemDragging && !isObjectDragging) {
			hoverTile = hoverCell;
		}

		if (hoverTile) {
			renderList.push({
				type: "highlight",
				sortKey: hoverTile.x + hoverTile.y - 0.05,
				draw: () => {
					const { sx, sy } = toScreen(hoverTile.x, hoverTile.y);
					ctx.beginPath();
					ctx.moveTo(sx, sy);
					ctx.lineTo(sx + tileW / 2, sy + tileH / 2);
					ctx.lineTo(sx, sy + tileH);
					ctx.lineTo(sx - tileW / 2, sy + tileH / 2);
					ctx.closePath();
					ctx.fillStyle = "rgba(255,255,255,0.5)";
					ctx.fill();
				},
			});
		}

		// 3. Placement Outline (Verplaatst naar renderList voor diepte)
		const objForOutline =
			(selectedBuildObject?.placement === "floor" && selectedBuildObject) || movingObject || draggedObject || draggedItem;
		if (objForOutline && hoverCell && !objForOutline.isWall && !objForOutline.wallId) {
			const isFlipped = objForOutline === selectedBuildObject ? isBuildObjectFlipped : objForOutline.flipped || false;
			const w = isFlipped ? objForOutline.depth || 1 : objForOutline.width || 1;
			const d = isFlipped ? objForOutline.width || 1 : objForOutline.depth || 1;

			let isValidPlacement = true;
			for (let dx = 0; dx < w; dx++) {
				for (let dy = 0; dy < d; dy++) {
					const tx = hoverCell.x + dx;
					const ty = hoverCell.y + dy;
					if (tx >= mapW || ty >= mapH) {
						isValidPlacement = false;
					} else if (
						!objForOutline.isFloor &&
						!objForOutline.isItem &&
						objForOutline !== draggedItem &&
						(isBlocked(tx, ty, true) || (Math.floor(ball.x) === tx && Math.floor(ball.y) === ty))
					) {
						isValidPlacement = false;
					}
				}
			}

			if (objForOutline === draggedItem) {
				const dist = Math.sqrt(Math.pow(hoverCell.x - Math.floor(ball.x), 2) + Math.pow(hoverCell.y - Math.floor(ball.y), 2));
				if (dist > 2) isValidPlacement = false;
			}

			renderList.push({
				type: "outline",
				sortKey: hoverCell.x + w - 1 + (hoverCell.y + d - 1) - 0.04, // Boven vloer (-0.1) en highlights (-0.05)
				draw: () => {
					const p0 = toScreen(hoverCell.x, hoverCell.y);
					const p1 = toScreen(hoverCell.x + w, hoverCell.y);
					const p2 = toScreen(hoverCell.x + w, hoverCell.y + d);
					const p3 = toScreen(hoverCell.x, hoverCell.y + d);

					ctx.save();
					ctx.strokeStyle = isValidPlacement ? "white" : "#f44336";
					ctx.lineWidth = 1;
					ctx.beginPath();
					ctx.moveTo(p0.sx, p0.sy);
					ctx.lineTo(p1.sx, p1.sy);
					ctx.lineTo(p2.sx, p2.sy);
					ctx.lineTo(p3.sx, p3.sy);
					ctx.closePath();
					ctx.stroke();
					ctx.restore();
				},
			});
		}

		let playerAdded = false;
		const playerTileX = Math.floor(ball.x);
		const playerTileY = Math.floor(ball.y);

		// OPTIMALISATIE: Maak een snelle lookup set voor item posities
		// Dit voorkomt dat we voor elk object door alle items moeten loopen (wat traag is bij veel items)
		const itemOccupiedTiles = new Set();
		items.forEach((item) => {
			itemOccupiedTiles.add(`${Math.floor(item.x)},${Math.floor(item.y)}`);
		});

		const transparentWalls = []; // NIEUW: Houdt transparante muren bij voor markers

		// Voeg objecten toe aan de renderlijst
		objects.forEach((obj) => {
			if (obj.isWall) {
				const t = obj.wallThickness || 0.25;
				const h = obj.wallHeight || 150;
				const color = obj.color || "#777";
				const bottomOffset = obj.isGate ? globalGateHeight : 0; // NIEUW: Poort begint boven de grond

				// NIEUW: Transparantie logica voor muren
				let isTransparent = false;
				const px = Math.floor(ball.x);
				const py = Math.floor(ball.y);

				const checkTiles = [];
				if (obj.flipped) {
					// Y-axis wall
					// Check tiles behind the wall (negative X direction) - Uitgebreid voor hoge muren
					for (let i = 1; i <= 5; i++) {
						const yBase = obj.y - Math.floor(i / 2);
						checkTiles.push({ x: obj.x - i, y: yBase });
						checkTiles.push({ x: obj.x - i, y: yBase - 1 });
					}
				} else {
					// X-axis wall
					// Check tiles behind the wall (negative Y direction) - Uitgebreid voor hoge muren
					for (let i = 1; i <= 5; i++) {
						const xBase = obj.x - Math.floor(i / 2);
						checkTiles.push({ x: xBase, y: obj.y - i });
						checkTiles.push({ x: xBase - 1, y: obj.y - i });
					}
				}

				if (checkTiles.some((t) => (t.x === px && t.y === py) || itemOccupiedTiles.has(`${t.x},${t.y}`))) {
					isTransparent = true;
				}
				if (isTransparent) transparentWalls.push(obj);

				// NIEUW: Aangepaste sortering voor poorten zodat je er "in" kunt staan
				// Normale muren: +0.5 (tussen de tegels in)
				// Poorten: +0.75 (zodat je eronder kunt staan tot 3/4 van de tegel)
				const sortOffset = obj.isGate ? 0.75 : 0.5;

				renderList.push({
					type: "wallObject",
					sortKey: obj.x + obj.y + sortOffset,
					draw: () => {
						let c1, c2, c3, c4;
						const wx = obj.x;
						const wy = obj.y;

						if (obj.flipped) {
							// Y-axis
							// Teken vanaf de lijn (wx) naar achteren (wx - t)
							c1 = toScreen(wx - t, wy);
							c2 = toScreen(wx, wy);
							c3 = toScreen(wx, wy + 1);
							c4 = toScreen(wx - t, wy + 1);
						} else {
							// X-axis
							// Teken vanaf de lijn (wy) naar achteren (wy - t)
							c1 = toScreen(wx, wy - t);
							c2 = toScreen(wx + 1, wy - t);
							c3 = toScreen(wx + 1, wy);
							c4 = toScreen(wx, wy);
						}

						// Draw 3D shape
						ctx.save();
						if (isTransparent) ctx.globalAlpha = 0.5;

						let highlightOverlay = null;

						// NIEUW: Highlight logic voor muren
						if (isBuildMode && (buildTool === "move" || buildTool === "delete") && !movingObject) {
							if (hoveredObjects.length > 0 && hoveredObjects[moveSelectionIndex] === obj) {
								if (buildTool === "delete") {
									ctx.filter = "sepia(1) hue-rotate(-50deg) saturate(5)";
								} else {
									highlightOverlay = "rgba(255, 255, 255, 0.4)"; // Witte overlay bij verplaatsen
								}
							}
						} else if (activeBuildCategory === "kleur" && hoveredCustomWallForColor === obj) {
							highlightOverlay = "rgba(255, 255, 255, 0.4)"; // Witte overlay bij kleuren
						}

						// 1. Top Face
						ctx.fillStyle = color;
						ctx.beginPath();
						ctx.moveTo(c1.sx, c1.sy - h);
						ctx.lineTo(c2.sx, c2.sy - h);
						ctx.lineTo(c3.sx, c3.sy - h);
						ctx.lineTo(c4.sx, c4.sy - h);
						ctx.closePath();
						ctx.fill();
						// Top Overlay (match existing walls)
						ctx.fillStyle = obj.flipped ? "rgba(0, 0, 0, 0.45)" : "rgba(0, 0, 0, 0.35)";
						ctx.fill();

						// 2. East Face (c2-c3)
						ctx.fillStyle = color;
						ctx.beginPath();
						ctx.moveTo(c2.sx, c2.sy - h);
						ctx.lineTo(c3.sx, c3.sy - h);
						ctx.lineTo(c3.sx, c3.sy - bottomOffset);
						ctx.lineTo(c2.sx, c2.sy - bottomOffset);
						ctx.fill();
						// Overlay: 0.0 (Front Y-wall) or 0.25 (Side X-wall)
						ctx.fillStyle = obj.flipped ? "rgba(0, 0, 0, 0.0)" : "rgba(0, 0, 0, 0.25)";
						ctx.fill();

						// 3. South Face (c3-c4)
						ctx.fillStyle = color;
						ctx.beginPath();
						ctx.moveTo(c3.sx, c3.sy - h);
						ctx.lineTo(c4.sx, c4.sy - h);
						ctx.lineTo(c4.sx, c4.sy - bottomOffset);
						ctx.lineTo(c3.sx, c3.sy - bottomOffset);
						ctx.fill();
						// Overlay: 0.25 (Side Y-wall) or 0.15 (Front X-wall)
						ctx.fillStyle = obj.flipped ? "rgba(0, 0, 0, 0.25)" : "rgba(0, 0, 0, 0.10)";
						ctx.fill();

						// NIEUW: 4. Bottom Face (Plafond van de poort)
						if (obj.isGate) {
							ctx.fillStyle = color;
							ctx.beginPath();
							ctx.moveTo(c1.sx, c1.sy - bottomOffset);
							ctx.lineTo(c2.sx, c2.sy - bottomOffset);
							ctx.lineTo(c3.sx, c3.sy - bottomOffset);
							ctx.lineTo(c4.sx, c4.sy - bottomOffset);
							ctx.closePath();
							ctx.fill();

							// NIEUW: Alleen schaduw voor niet-geroteerde (horizontale) poorten om te matchen met de rest van de muur
							if (!obj.flipped) {
								ctx.fillStyle = "rgba(0, 0, 0, 0.10)"; // Match top-face overlay
								ctx.fill();
							}
						}

						// NIEUW: Teken highlight overlay indien nodig
						if (highlightOverlay) {
							ctx.fillStyle = highlightOverlay;
							// Top
							ctx.beginPath();
							ctx.moveTo(c1.sx, c1.sy - h);
							ctx.lineTo(c2.sx, c2.sy - h);
							ctx.lineTo(c3.sx, c3.sy - h);
							ctx.lineTo(c4.sx, c4.sy - h);
							ctx.closePath();
							ctx.fill();
							// East
							ctx.beginPath();
							ctx.moveTo(c2.sx, c2.sy - h);
							ctx.lineTo(c3.sx, c3.sy - h);
							ctx.lineTo(c3.sx, c3.sy - bottomOffset);
							ctx.lineTo(c2.sx, c2.sy - bottomOffset);
							ctx.fill();
							// South
							ctx.beginPath();
							ctx.moveTo(c3.sx, c3.sy - h);
							ctx.lineTo(c4.sx, c4.sy - h);
							ctx.lineTo(c4.sx, c4.sy - bottomOffset);
							ctx.lineTo(c3.sx, c3.sy - bottomOffset);
							ctx.fill();
						}

						ctx.restore();
					},
				});
				return;
			}

			const w = obj.flipped ? obj.depth || 1 : obj.width || 1;
			const d = obj.flipped ? obj.width || 1 : obj.depth || 1;

			// Genereer dynamisch de lijst met tegels die "achter" dit object liggen
			// Dit zijn de tegels direct ten noorden (y-1) en westen (x-1) van de bounding box
			let behindTiles = [];

			// Rij boven het object
			for (let i = 0; i < w; i++) {
				behindTiles.push({ x: obj.x + i, y: obj.y - 1 });
			}
			// Kolom links van het object
			for (let j = 0; j < d; j++) {
				behindTiles.push({ x: obj.x - 1, y: obj.y + j });
			}
			// De hoek linksboven
			behindTiles.push({ x: obj.x - 1, y: obj.y - 1 });

			// Voor hoge objecten voegen we extra tegels toe (simpele benadering)
			if (obj.height === 2) {
				behindTiles.push({ x: obj.x - 1, y: obj.y - 2 }); // Twee boven, een links (209)
				behindTiles.push({ x: obj.x - 2, y: obj.y - 2 }); // Twee boven, twee links (208)
				behindTiles.push({ x: obj.x - 2, y: obj.y - 1 }); // Een boven, twee links (233)
			}

			// Check of speler achter het object staat OF in het object staat (voor tile 106/131 etc)
			const isPlayerBehind = behindTiles.some((t) => playerTileX === t.x && playerTileY === t.y);
			const isPlayerInside = playerTileX >= obj.x && playerTileX < obj.x + w && playerTileY >= obj.y && playerTileY < obj.y + d;

			// Check of een item achter het object staat
			const isItemBehind = behindTiles.some((t) => itemOccupiedTiles.has(`${t.x},${t.y}`));

			// NIEUW: Split object in tegels voor correcte diepte-sortering (voorkomt clipping door muren)
			for (let i = 0; i < w; i++) {
				for (let j = 0; j < d; j++) {
					const tx = obj.x + i;
					const ty = obj.y + j;

					// NIEUW: Objecten iets naar voren (+0.8) zodat ze voor muren (+0.5) staan. Vloeren (+0.1) erachter.
					let sortKey = tx + ty + (obj.isFloor ? 0.1 : 0.8);

					renderList.push({
						type: "object_part",
						sortKey: sortKey,
						draw: () => {
							// Bereken positie van het hele object (zoals voorheen)
							const centerX = obj.x + (w - 1) / 2;
							const centerY = obj.y + (d - 1) / 2;
							const { sx, sy } = toScreen(centerX, centerY);

							// Bereken positie van deze specifieke tegel voor clipping
							const tileScreen = toScreen(tx, ty);

							ctx.save();

							// Clipping path voor deze tegel-kolom
							ctx.beginPath();
							// Diamond punten
							const tRight = { x: tileScreen.sx + tileW / 2, y: tileScreen.sy + tileH / 2 };
							const tBottom = { x: tileScreen.sx, y: tileScreen.sy + tileH };
							const tLeft = { x: tileScreen.sx - tileW / 2, y: tileScreen.sy + tileH / 2 };

							// Breid iets uit om naden te voorkomen (0.5px)
							const expand = 0.5;

							// We tekenen een pad dat de tegel en alles erboven omvat
							// Start onderaan
							ctx.moveTo(tBottom.x, tBottom.y + expand);
							// Naar rechts
							ctx.lineTo(tRight.x + expand, tRight.y);
							// Omhoog naar oneindig (relatief aan scherm)
							ctx.lineTo(tRight.x + expand, tRight.y - 2000);
							// Naar links boven
							ctx.lineTo(tLeft.x - expand, tLeft.y - 2000);
							// Naar links beneden
							ctx.lineTo(tLeft.x - expand, tLeft.y);
							ctx.closePath();

							ctx.clip();

							// Transparency
							ctx.globalAlpha = !obj.isFloor && (isPlayerBehind || isPlayerInside || isItemBehind) ? 0.5 : 1;

							// Highlight logica
							if (isBuildMode) {
								let shouldHighlight = false;
								let highlightFilter = "";
								if ((buildTool === "move" || buildTool === "delete") && !movingObject) {
									if (hoveredObjects.length > 0 && hoveredObjects[moveSelectionIndex] === obj) {
										shouldHighlight = true;
										highlightFilter = buildTool === "delete" ? "sepia(1) hue-rotate(-50deg) saturate(5)" : "brightness(1.5)";
									}
								} else if ((buildTool === "place" || movingObject) && hoverCell) {
									const hw = obj.flipped ? obj.depth || 1 : obj.width || 1;
									const hd = obj.flipped ? obj.width || 1 : obj.depth || 1;
									if (hoverCell.x >= obj.x && hoverCell.x < obj.x + hw && hoverCell.y >= obj.y && hoverCell.y < obj.y + hd) {
										if (obj !== movingObject && !obj.isFloor) {
											shouldHighlight = true;
											highlightFilter = "brightness(1.5)";
										}
									}
								}
								if (shouldHighlight) ctx.filter = highlightFilter;
							}

							// Image selection
							const isTall = obj.height === 2;
							const isWide = obj.width === 2;
							let finalImg;
							if (obj.runtimeImage) finalImg = obj.runtimeImage;
							else if (obj.name === "Pong") finalImg = pongImg;
							else if (obj.name === "Winkel") finalImg = winkelImg;
							else if (obj.name === "Brede Winkel") finalImg = winkelImg96B;
							else if (obj.name === "Container") finalImg = containerImg;
							else if (obj.name === "Kraan") finalImg = kraanImg;
							else if (obj.name === "Hoge Kraan") finalImg = kraanImg96;
							else if (obj.name === "Grote Container") finalImg = containerImg96;
							else if (obj.name === "Brede Container") finalImg = containerImg96B;
							else if (obj.name === "Prullenbak") finalImg = trashImg;
							else if (obj.name === "Brede Prullenbak") finalImg = trashImg96B;
							else if (obj.isFloor) finalImg = floorImg;
							else if (obj.moveable) finalImg = isWide ? moveableObjectImg96B : moveableObjectImg;
							else {
								if (isWide) finalImg = objectImg96B;
								else if (isTall) finalImg = objectImg96;
								else finalImg = objectImg;
							}

							const imgWidth = finalImg.width || 64;
							const imgHeight = finalImg.height || (isTall ? 96 : 64);

							if (obj.flipped) ctx.scale(-1, 1);

							if (obj.isCustom && obj.xOffset !== undefined) {
								const origin = toScreen(obj.x, obj.y);
								const drawY = origin.sy - obj.yOffset;
								if (obj.flipped) ctx.drawImage(finalImg, -origin.sx - obj.xOffset, drawY, imgWidth, imgHeight);
								else {
									const drawX = origin.sx - obj.xOffset;
									ctx.drawImage(finalImg, drawX, drawY, imgWidth, imgHeight);
								}
							} else {
								const totalDim = (obj.width || 1) + (obj.depth || 1);
								const verticalOffset = totalDim * 8 + 16;
								ctx.drawImage(
									finalImg,
									obj.flipped ? -sx - imgWidth / 2 : sx - imgWidth / 2,
									sy - imgHeight + verticalOffset,
									imgWidth,
									imgHeight
								);
							}

							ctx.restore();
						},
					});
				}
			}
		});

		// NIEUW: Marker Marks (Zwarte strepen) - Verplaatst en aangepast voor transparantie
		activeMarks.forEach((m) => {
			let alpha = m.life;

			// Check of marker op een transparante muur zit
			const isOnTransparentWall = transparentWalls.some((wall) => {
				if (wall.flipped) {
					return Math.abs(m.x - wall.x) < 0.1 && m.y >= wall.y && m.y < wall.y + (wall.width || 1);
				} else {
					return Math.abs(m.y - wall.y) < 0.1 && m.x >= wall.x && m.x < wall.x + (wall.width || 1);
				}
			});

			if (isOnTransparentWall) alpha *= 0.25; // 75% transparant

			renderList.push({
				type: "mark",
				sortKey: m.x + m.y + (m.sortOffset || -0.03), // Gebruik offset indien beschikbaar (voor muren)
				draw: () => {
					const { sx, sy } = toScreen(m.x, m.y);
					const drawY = sy - m.z;
					const size = m.size || 2; // Gebruik opgeslagen grootte of default
					ctx.save();
					ctx.globalAlpha = alpha;
					ctx.fillStyle = m.color || "#000000";
					ctx.fillRect(sx - size / 2, drawY - size / 2, size, size);
					ctx.restore();
				},
			});
		});

		// Voeg items toe aan de renderlijst
		items.forEach((item) => {
			// Sla over als het item wordt versleept, want die wordt apart getekend
			if (item === draggedItem) return;

			// NIEUW: Gebruik exacte positie voor sortering zodat items niet onder vloeren schuiven
			let sortKey = item.x + item.y - 0.02;

			// FIX: Als item op een object ligt, zorg dat het ALTIJD na dat object getekend wordt
			// Dit lost het probleem op dat items op de 'achterste' tegel van een tafel erachter vallen.
			const tileX = Math.floor(item.x);
			const tileY = Math.floor(item.y);
			const objUnder = objects.find((o) => {
				const w = o.flipped ? o.depth || 1 : o.width || 1;
				const d = o.flipped ? o.width || 1 : o.depth || 1;
				return tileX >= o.x && tileX < o.x + w && tileY >= o.y && tileY < o.y + d;
			});

			if (objUnder && (item.z || 0) >= (objUnder.height || 1) * 32) {
				const w = objUnder.flipped ? objUnder.depth || 1 : objUnder.width || 1;
				const d = objUnder.flipped ? objUnder.width || 1 : objUnder.depth || 1;
				// NIEUW: Update sortKey om te matchen met nieuwe object sortering (+0.8)
				const objSortKey = objUnder.x + w - 1 + (objUnder.y + d - 1) + 0.8;
				// Forceer item net iets voor het object in de sortering
				if (sortKey <= objSortKey) sortKey = objSortKey + 0.01;
			}

			renderList.push({
				type: "item",
				sortKey: sortKey,
				draw: () => {
					const { sx, sy } = toScreen(item.x, item.y);

					// Bereken de tekenpositie inclusief de stuiter-hoogte (z)
					const drawY = sy - (item.z || 0);

					ctx.save();

					// Highlight logica voor items
					let shouldHighlight = false;
					let highlightFilter = "";

					// 1. Verwijderen (Rood)
					if (isBuildMode && buildTool === "delete" && hoverCell) {
						if (Math.floor(item.x) === hoverCell.x && Math.floor(item.y) === hoverCell.y) {
							// Check of er een object bovenop ligt (objecten hebben voorrang bij verwijderen)
							const objectOnTile = objects.find((o) => {
								const w = o.flipped ? o.depth || 1 : o.width || 1;
								const d = o.flipped ? o.width || 1 : o.depth || 1;
								return hoverCell.x >= o.x && hoverCell.x < o.x + w && hoverCell.y >= o.y && hoverCell.y < o.y + d;
							});

							// Gebruik de selectie uit het menu als die er is (hoveredObjects)
							if (hoveredObjects.length > 0) {
								if (hoveredObjects[moveSelectionIndex] === item) {
									shouldHighlight = true;
									highlightFilter = "sepia(1) hue-rotate(-50deg) saturate(5)";
								}
							}
							// Fallback voor als menu nog niet geupdate is of leeg is (zou niet moeten gebeuren met mousemove logic)
							else if (!objectOnTile) {
								shouldHighlight = true;
								highlightFilter = "sepia(1) hue-rotate(-50deg) saturate(5)";
							}
						}
					}
					// 2. Oppakken (Wit) - Alleen in speelmodus
					else if (!isBuildMode && !isItemDragging && !isObjectDragging && hoverCell) {
						if (Math.floor(item.x) === hoverCell.x && Math.floor(item.y) === hoverCell.y) {
							const dist = Math.sqrt(
								Math.pow(Math.floor(ball.x) - Math.floor(item.x), 2) + Math.pow(Math.floor(ball.y) - Math.floor(item.y), 2)
							);
							shouldHighlight = true;
							if (dist <= 2) {
								highlightFilter = "brightness(1.5)";
							} else {
								highlightFilter = "sepia(1) hue-rotate(-50deg) saturate(5)";
							}
						}
					}
					// 3. Verplaatsen (Wit) - Bouwmodus
					else if (isBuildMode && buildTool === "move" && !movingObject && hoveredObjects.length > 0) {
						if (hoveredObjects[moveSelectionIndex] === item) {
							shouldHighlight = true;
							highlightFilter = "brightness(2)";
						}
					}

					if (shouldHighlight && highlightFilter) {
						ctx.filter = highlightFilter;
					}

					// Verplaats naar het midden van waar het item getekend moet worden
					ctx.translate(sx, drawY);
					// Roteer als het item dat kan
					if (item.canRotate) {
						ctx.rotate(item.rotation || 0);
						ctx.drawImage(
							item.image,
							-item.image.width / 2, // Teken gecentreerd op het rotatiepunt
							-item.image.height / 2
						);
					} else if (item.canTopple) {
						ctx.rotate(item.rotation || 0);
						ctx.drawImage(
							item.image,
							-item.image.width / 2, // Horizontaal gecentreerd
							-item.image.height // Verticaal: ankerpunt onderaan
						);
					} else {
						ctx.drawImage(item.image, -item.image.width / 2, -item.image.height / 2);
					}

					ctx.restore();
				},
			});
		});

		// Voeg ANDERE spelers toe aan de renderlijst
		Object.keys(otherPlayers).forEach((id) => {
			const p = otherPlayers[id];
			renderList.push({
				type: "otherPlayer",
				sortKey: p.x + p.y,
				draw: () => {
					drawCharacter(
						p.x,
						p.y,
						false,
						p.color || "green",
						p.hopOffset || 0,
						p.isSmoking,
						p.smokingStartTime,
						p.smokingItemType,
						p.isDrinking,
						p.drinkingStartTime,
						p.drinkingItemType
					);
				},
			});
		});

		// Voeg de speler toe aan de renderlijst
		renderList.push({
			type: "player",
			sortKey: ball.x + ball.y,
			draw: drawBall,
		});

		// Voeg de bouw-preview toe aan de renderlijst voor correcte diepte
		const objectToPreview =
			((selectedBuildObject?.placement === "floor" || selectedBuildObject?.placement === "wall_structure") && selectedBuildObject) ||
			movingObject ||
			draggedObject ||
			(buildTool === "place_wall" ? { isWallPreview: true } : null);
		if (objectToPreview && hoverCell) {
			if (objectToPreview.isWallPreview || objectToPreview.isWall || objectToPreview.placement === "wall_structure") {
				// Wall preview drawing
				const wallWidth = objectToPreview.width || 1;

				for (let i = 0; i < wallWidth; i++) {
					const isFlipped = objectToPreview === movingObject ? objectToPreview.flipped : isBuildObjectFlipped;
					const offsetX = isFlipped ? 0 : i;
					const offsetY = isFlipped ? i : 0;

					renderList.push({
						type: "preview",
						sortKey: hoverCell.x + offsetX + (hoverCell.y + offsetY),
						draw: () => {
							// Gebruik specifieke eigenschappen als het een bestaande muur is, anders globals
							const t = objectToPreview.wallThickness || globalWallThickness;
							const h = objectToPreview.wallHeight || globalWallHeight;

							let c1, c2, c3, c4;
							const wx = (objectToPreview === movingObject ? objectToPreview.x : hoverCell.x) + offsetX;
							const wy = (objectToPreview === movingObject ? objectToPreview.y : hoverCell.y) + offsetY;

							if (isFlipped) {
								// Y-axis
								c1 = toScreen(wx - t, wy);
								c2 = toScreen(wx, wy);
								c3 = toScreen(wx, wy + 1);
								c4 = toScreen(wx - t, wy + 1);
							} else {
								// X-axis
								c1 = toScreen(wx, wy - t);
								c2 = toScreen(wx + 1, wy - t);
								c3 = toScreen(wx + 1, wy);
								c4 = toScreen(wx, wy);
							}

							// Validatie check voor kleur
							const isValid = isFlipped ? wx > 0 && wx <= mapW && wy >= 0 && wy < mapH : wx >= 0 && wx < mapW && wy > 0 && wy <= mapH;

							// Check collision met andere muren
							const isColliding = isWallAt(wx, wy, isFlipped, objectToPreview === movingObject ? movingObject : null);

							ctx.save();
							// Gebruik de gevraagde kleuren met wat transparantie voor de preview
							// #7bff00 = 123, 255, 0 | #f44336 = 244, 67, 54
							const color = isValid && !isColliding ? "rgba(123, 255, 0, 0.6)" : "rgba(244, 67, 54, 0.6)";

							// 1. Top Face
							ctx.fillStyle = color;
							ctx.beginPath();
							ctx.moveTo(c1.sx, c1.sy - h);
							ctx.lineTo(c2.sx, c2.sy - h);
							ctx.lineTo(c3.sx, c3.sy - h);
							ctx.lineTo(c4.sx, c4.sy - h);
							ctx.closePath();
							ctx.fill();
							ctx.fillStyle = isFlipped ? "rgba(0, 0, 0, 0.45)" : "rgba(0, 0, 0, 0.35)";
							ctx.fill();

							// 2. East Face
							ctx.fillStyle = color;
							ctx.beginPath();
							ctx.moveTo(c2.sx, c2.sy - h);
							ctx.lineTo(c3.sx, c3.sy - h);
							ctx.lineTo(c3.sx, c3.sy);
							ctx.lineTo(c2.sx, c2.sy);
							ctx.fill();
							ctx.fillStyle = isFlipped ? "rgba(0, 0, 0, 0.0)" : "rgba(0, 0, 0, 0.25)";
							ctx.fill();

							// 3. South Face
							ctx.fillStyle = color;
							ctx.beginPath();
							ctx.moveTo(c3.sx, c3.sy - h);
							ctx.lineTo(c4.sx, c4.sy - h);
							ctx.lineTo(c4.sx, c4.sy);
							ctx.lineTo(c3.sx, c3.sy);
							ctx.fill();
							ctx.fillStyle = isFlipped ? "rgba(0, 0, 0, 0.25)" : "rgba(0, 0, 0, 0.10)";
							ctx.fill();

							ctx.restore();
						},
					});
				}
			} else {
				// Check geldigheid (rekening houdend met width/depth)
				const isFlipped = objectToPreview === selectedBuildObject ? isBuildObjectFlipped : objectToPreview.flipped || false;
				const w = isFlipped ? objectToPreview.depth || 1 : objectToPreview.width || 1;
				const d = isFlipped ? objectToPreview.width || 1 : objectToPreview.depth || 1;
				let isValidPlacement = true;

				for (let dx = 0; dx < w; dx++) {
					for (let dy = 0; dy < d; dy++) {
						const tx = hoverCell.x + dx;
						const ty = hoverCell.y + dy;
						if (tx >= mapW || ty >= mapH) {
							isValidPlacement = false;
						} else if (
							!objectToPreview.isFloor &&
							!objectToPreview.isItem &&
							(isBlocked(tx, ty, true) || (Math.floor(ball.x) === tx && Math.floor(ball.y) === ty))
						) {
							isValidPlacement = false;
						}
					}
				}

				renderList.push({
					type: "preview",
					sortKey: hoverCell.x + w - 1 + (hoverCell.y + d - 1),
					draw: () => {
						const centerX = hoverCell.x + (w - 1) / 2;
						const centerY = hoverCell.y + (d - 1) / 2;
						const { sx, sy } = toScreen(centerX, centerY);
						const isTall = objectToPreview.height === 2;
						const isWide = objectToPreview.width === 2;
						let finalImg;

						if (objectToPreview.runtimeImage) {
							finalImg = objectToPreview.runtimeImage;
						} else if (objectToPreview.image && objectToPreview.image.src) {
							finalImg = objectToPreview.image;
						} else if (objectToPreview.name === "Pong") {
							finalImg = pongImg;
						} else if (objectToPreview.name === "Winkel") {
							finalImg = winkelImg;
						} else if (objectToPreview.name === "Brede Winkel") {
							finalImg = winkelImg96B;
						} else if (objectToPreview.name === "Container") {
							finalImg = containerImg;
						} else if (objectToPreview.name === "Grote Container") {
							finalImg = containerImg96;
						} else if (objectToPreview.name === "Brede Container") {
							finalImg = containerImg96B;
						} else if (objectToPreview.name === "Prullenbak") {
							finalImg = trashImg;
						} else if (objectToPreview.name === "Brede Prullenbak") {
							finalImg = trashImg96B;
						} else if (objectToPreview.isFloor) {
							finalImg = floorImg;
						} else if (objectToPreview.moveable) {
							finalImg = isWide ? moveableObjectImg96B : moveableObjectImg;
						} else {
							if (isWide) {
								finalImg = objectImg96B;
							} else if (isTall) {
								finalImg = objectImg96;
							} else {
								finalImg = objectImg;
							}
						}

						const imgWidth = finalImg.width || 64;
						const imgHeight = finalImg.height || (isTall ? 96 : 64);

						const totalDim = (objectToPreview.width || 1) + (objectToPreview.depth || 1);
						const verticalOffset = totalDim * 8 + 16;

						// NIEUW: Hoogte correctie voor items op objecten
						let zOffset = 0;
						if (objectToPreview.isItem) {
							zOffset = getSurfaceHeight(hoverCell.x, hoverCell.y);
						}

						ctx.save();

						// Kleur overlay logic
						if (isValidPlacement) {
							ctx.filter = "sepia(1) hue-rotate(90deg) saturate(3)"; // Groene gloed
						} else {
							ctx.filter = "sepia(1) hue-rotate(-50deg) saturate(5)"; // Rode gloed
						}
						ctx.globalAlpha = 0.6;

						// NIEUW: Gebruik offsets ook voor preview
						if (objectToPreview.isCustom && objectToPreview.xOffset !== undefined) {
							const origin = toScreen(objectToPreview.x, objectToPreview.y); // x/y zijn hier hoverCell
							// Bij preview gebruiken we hoverCell als basis, maar toScreen verwacht x,y
							// We moeten de 'origin' herberekenen op basis van hoverCell
							// sx, sy hierboven is het midden, we hebben de top-left van de box nodig (origin)
							const originSX = toScreen(hoverCell.x, hoverCell.y).sx;
							const originSY = toScreen(hoverCell.x, hoverCell.y).sy;

							const drawY = originSY - objectToPreview.yOffset;

							if (isFlipped) ctx.scale(-1, 1);
							const drawX = isFlipped ? -originSX - objectToPreview.xOffset : originSX - objectToPreview.xOffset;
							ctx.drawImage(finalImg, drawX, drawY, imgWidth, imgHeight);
						} else {
							if (isFlipped) ctx.scale(-1, 1);
							ctx.drawImage(
								finalImg,
								isFlipped ? -sx - imgWidth / 2 : sx - imgWidth / 2,
								sy - imgHeight + verticalOffset - zOffset,
								imgWidth,
								imgHeight
							);
						}

						ctx.restore();
					},
				});
			}
		}

		// Sorteer op x+y voor isometrische diepte
		renderList.sort((a, b) => a.sortKey - b.sortKey);

		// Alles tekenen
		for (let item of renderList) {
			item.draw();
		}
		// --- Einde renderlijst ---

		// NIEUW: Weer effecten tekenen NA de wereld, maar VOOR de UI (ballonnen/prompts)
		// Dit zorgt ervoor dat regen over de spelers valt, maar onder de chatballonnen door gaat.
		ctx.save();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // Reset transform naar screen space
		updateAndDrawWeather(ctx, window.innerWidth, window.innerHeight);
		ctx.restore();

		drawInteractionPrompts(); // Teken interactie prompts bovenop de wereld
		drawChatBallon();
		drawPlayerNames(); // NIEUW: Teken namen bij hover

		requestAnimationFrame(renderLoop);
	}

	requestAnimationFrame(renderLoop); // Start de render loop
})(); // Einde van de IIFE
