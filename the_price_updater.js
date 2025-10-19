
/**
 * =================================================================
 * ГЛОБАЛЬНАЯ КОНФИГУРАЦИЯ
 * Все основные настройки производятся здесь.
 * =================================================================
 */
const CONFIG = {
    // --- Telegram ---
    TG_BOT_TOKEN: scriptProperties.getProperty('TELEGRAM_BOT_TOKEN'),
    TG_CHAT_ID: scriptProperties.getProperty('PRICES_CHAT_TG'), // ID чата или канала (например, '@mychannel' или '-1001234567890')
    
    // --- Названия листов ---
    // --- Названия листов ---
    SHEET_NAMES: {
      PRODUCTS: "Монитор цен", // Название вашего листа с товарами
      DIRECTORY: "Справочник постов", // Системный лист для ID сообщений (создастся автоматически)
      SETTINGS: "Настройки ТГ" // Системный лист для ID навигационного поста (создастся автоматически)
    },
  
    // --- Названия столбцов (должны совпадать с заголовками в таблице) ---
    COLUMN_NAMES: {
      // Лист "Товары"
      GROUP: "Название группы (для поста)",
      CATEGORY: "Категории для тг", // Для подзаголовков внутри поста
      FLAG: "Флаги",
      NAME: "Наименование",
      PRICE: "Цена закупки сегодня",
  
      // Лист "Справочник постов"
      DIR_GROUP: "Название группы",
      DIR_MESSAGE_ID: "message_id",
      DIR_STATUS: "Статус"
    },
  
    // --- Шаблоны сообщений ---
    MESSAGE_TEMPLATES: {
      HEADER: `<b>{groupName}</b>\n\n🗓️ Дата: ${Utilities.formatDate(new Date(), "GMT+3", "dd.MM.yyyy")}\n\n`,
      FOOTER: "\n<b><i>✅ Полностью оригинальные, запечатанные устройства.</i></b>\n\n💬 по любым вопросам Telegram: @leon_leman",
      OUT_OF_STOCK: `<b>{groupName}</b>\n\n🗓️ Дата: ${Utilities.formatDate(new Date(), "GMT+3", "dd.MM.yyyy")}\n\nТовары в этой категории временно отсутствуют или распроданы.`,
      NAV_HEADER: `<b>LEMAN IMPORT | НАВИГАЦИЯ</b>\n\n🗓️ Прайс-лист актуален на ${Utilities.formatDate(new Date(), "GMT+3", "dd.MM.yyyy")}\n\n👇 Навигация по категориям:`
    },
    
    // --- НОВОЕ: Настройки поведения ---
    // Показывать ли заглушку "Товар распродан" для постов, где нет товаров.
    // true - да, пост будет изменен на заглушку.
    // false - нет, пост просто не будет обновляться (но из навигации все равно исчезнет).
    SHOW_OUT_OF_STOCK_PLACEHOLDERS: false, 
    SHOW_ITEMS_WITHOUT_PRICE: false,
    // --- Прочие настройки ---
    PRICE_MARKUP: 5500,
    PRICE_MARKUP_THRESHOLD: 20000,
    PRICE_MARKUP_LOW: 2000
  };
  
  // --- Базовый URL для API Telegram ---
  const TG_BASE_URL = `https://api.telegram.org/bot${CONFIG.TG_BOT_TOKEN}/`;
  
  /**
   * =================================================================
   * ГЛАВНАЯ ФУНКЦИЯ - ОРКЕСТРАТОР (ОТКАЗОУСТОЙЧИВАЯ ВЕРСИЯ)
   * Запускает весь процесс обновления с механизмом блокировки.
   * =================================================================
   */
  function runPriceUpdater() {
    const scriptProperties = PropertiesService.getScriptProperties();
    const lock = scriptProperties.getProperty('SCRIPT_STATUS_TG_UPDATE');
  
    if (lock === 'RUNNING') {
      console.warn("--- [ПРЕДУПРЕЖДЕНИЕ] Попытка запуска скрипта, пока предыдущий экземпляр еще выполняется или завершился с ошибкой. Запуск отменен. ---");
      return;
    }
  
    try {
      scriptProperties.setProperty('SCRIPT_STATUS', 'RUNNING');
      console.info("--- [НАЧАЛО] Установлена блокировка. Запуск скрипта обновления прайс-листа ---");
  
      const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
      
      initializeSystemSheets(spreadsheet);
      processProductPosts(spreadsheet);
      processNavigationPost(spreadsheet);
  
      console.info("--- [УСПЕХ] Скрипт успешно завершил работу. ---");
    
    } catch (e) {
      console.error(`--- [КРИТИЧЕСКАЯ ОШИБКА] Произошла ошибка на верхнем уровне: ${e.toString()} \nСтек: ${e.stack} ---`);
    
    } finally {
      scriptProperties.setProperty('SCRIPT_STATUS', 'IDLE');
      console.info("--- [ЗАВЕРШЕНИЕ] Блокировка снята. ---");
    }
  }
  
  /**
   * =================================================================
   * БЛОК 1: ИНИЦИАЛИЗАЦИЯ И УТИЛИТЫ
   * =================================================================
   */
  
  function initializeSystemSheets(spreadsheet) {
    console.log("Проверка и инициализация системных листов...");
    getOrCreateSheet(
      spreadsheet,
      CONFIG.SHEET_NAMES.DIRECTORY, [CONFIG.COLUMN_NAMES.DIR_GROUP, CONFIG.COLUMN_NAMES.DIR_MESSAGE_ID, CONFIG.COLUMN_NAMES.DIR_STATUS]
    );
    getOrCreateSheet(
      spreadsheet,
      CONFIG.SHEET_NAMES.SETTINGS, ["Ключ", "Значение"]
    );
    console.log("Системные листы готовы.");
  }
  
  function getOrCreateSheet(ss, sheetName, headers) {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 2000;
  
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        let sheet = ss.getSheetByName(sheetName);
        if (!sheet) {
          sheet = ss.insertSheet(sheetName);
          console.warn(`Лист "${sheetName}" не найден, создан новый.`);
          if (headers && headers.length > 0) {
            sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
          }
        }
        return sheet;
      } catch (e) {
        if (e.message.includes('timed out')) {
          console.warn(`Попытка ${i + 1} из ${MAX_RETRIES}: Таймаут при доступе к листу "${sheetName}". Повтор...`);
          if (i < MAX_RETRIES - 1) {
            Utilities.sleep(RETRY_DELAY);
          } else {
            console.error(`Не удалось получить доступ к листу "${sheetName}" после ${MAX_RETRIES} попыток.`);
            throw e;
          }
        } else {
          throw e;
        }
      }
    }
  }
  
  function appendRowWithRetry(sheet, rowData) {
      const MAX_RETRIES = 3;
      const RETRY_DELAY = 2000;
      for (let i = 0; i < MAX_RETRIES; i++) {
          try {
              sheet.appendRow(rowData);
              return;
          } catch (e) {
              if (e.message.includes('timed out')) {
                  console.warn(`Попытка ${i + 1} из ${MAX_RETRIES}: Таймаут при записи в лист "${sheet.getName()}". Повтор...`);
                  if (i < MAX_RETRIES - 1) Utilities.sleep(RETRY_DELAY);
                  else throw e;
              } else {
                  throw e;
              }
          }
      }
  }
  
  function getColumnIndexMap(headers) {
    const map = {};
    headers.forEach((header, index) => { map[header] = index; });
    return map;
  }
  
  /**
   * =================================================================
   * БЛОК 2: ОСНОВНАЯ ЛОГИКА - ОБРАБОТКА ПОСТОВ
   * =================================================================
   */
  
  function processProductPosts(spreadsheet) {
    console.log("--- Начало обработки постов с товарами ---");
  
    const productSheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAMES.PRODUCTS);
    const directorySheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAMES.DIRECTORY);
  
    if (!productSheet) throw new Error(`Лист с товарами "${CONFIG.SHEET_NAMES.PRODUCTS}" не найден!`);
  
    const productDataRaw = productSheet.getDataRange().getValues();
    const directoryData = directorySheet.getDataRange().getValues();
  
    const productHeaders = productDataRaw.shift(); // Извлекаем заголовки из данных
    
    // =================================================================
    // НОВЫЙ БЛОК: Проверка наличия обязательных столбцов
    // =================================================================
    const requiredColumns = [
      CONFIG.COLUMN_NAMES.GROUP,
      CONFIG.COLUMN_NAMES.CATEGORY,
      CONFIG.COLUMN_NAMES.NAME,
      CONFIG.COLUMN_NAMES.PRICE
    ];
  
    const missingColumns = requiredColumns.filter(colName => !productHeaders.includes(colName));
  
    if (missingColumns.length > 0) {
      const errorMessage = `Критическая ошибка: В листе "${CONFIG.SHEET_NAMES.PRODUCTS}" отсутствуют необходимые столбцы: [${missingColumns.join(', ')}]. Проверьте, что заголовки написаны правильно, и перезапустите скрипт.`;
      console.error(errorMessage);
      throw new Error(errorMessage); // Прерываем выполнение
    }
    console.log("Проверка обязательных заголовков столбцов пройдена успешно.");
    // =================================================================
    // Конец нового блока
    // =================================================================
  
    const productColMap = getColumnIndexMap(productHeaders);
    const directoryHeaders = directoryData.shift() || [];
    const directoryColMap = getColumnIndexMap(directoryHeaders);
  
    // Фильтрация некорректных строк
    const colGroupIndex = productColMap[CONFIG.COLUMN_NAMES.GROUP];
    const colCategoryIndex = productColMap[CONFIG.COLUMN_NAMES.CATEGORY];
    const productData = productDataRaw.filter(row => row[colGroupIndex]);
  
    
    if (productDataRaw.length !== productData.length) {
      console.warn(`Отфильтровано ${productDataRaw.length - productData.length} строк без Названия группы или Категории.`);
    }
  
    // 1. Составляем список актуальных групп товаров
    const activeProductGroups = new Set(productData.map(row => row[colGroupIndex]));
    console.log(`Найдено ${activeProductGroups.size} активных групп товаров.`);
  
    // 2. Обновляем статусы в справочнике
    let hasStatusChanges = false;
    const directoryMap = new Map();
    directoryData.forEach((row, index) => {
      const groupName = row[directoryColMap[CONFIG.COLUMN_NAMES.DIR_GROUP]];
      const currentStatus = row[directoryColMap[CONFIG.COLUMN_NAMES.DIR_STATUS]];
      const newStatus = activeProductGroups.has(groupName) ? "Активен" : "Неактивен";
  
      if (currentStatus !== newStatus) {
        row[directoryColMap[CONFIG.COLUMN_NAMES.DIR_STATUS]] = newStatus;
        hasStatusChanges = true;
      }
      directoryMap.set(groupName, {
        messageId: row[directoryColMap[CONFIG.COLUMN_NAMES.DIR_MESSAGE_ID]],
        status: newStatus,
        rowIndex: index + 2
      });
    });
  
    if (hasStatusChanges && directoryData.length > 0) {
      directorySheet.getRange(2, 1, directoryData.length, directoryHeaders.length).setValues(directoryData);
      console.log("Статусы в справочнике обновлены.");
    }
    
    // 3. Обновляем посты в Telegram
    directoryMap.forEach((data, groupName) => {
      const messageId = data.messageId;
      if (data.status === "Активен") {
        const groupProducts = productData.filter(row => row[colGroupIndex] === groupName);
        const messageText = formatProductPost(groupProducts, productColMap, groupName);
        editTelegramMessage(CONFIG.TG_CHAT_ID, messageId, messageText);
      } else {
        if (CONFIG.SHOW_OUT_OF_STOCK_PLACEHOLDERS) {
          const messageText = CONFIG.MESSAGE_TEMPLATES.OUT_OF_STOCK.replace('{groupName}', groupName);
          editTelegramMessage(CONFIG.TG_CHAT_ID, messageId, messageText);
          console.log(`Группа "${groupName}" неактивна. Пост ${messageId} обновлен на заглушку.`);
        } else {
          console.log(`Группа "${groupName}" неактивна. Пост ${messageId} пропущен согласно настройкам.`);
        }
      }
    });
  
    // 4. Создаем посты для новых групп
    activeProductGroups.forEach(groupName => {
      if (!directoryMap.has(groupName)) {
        console.warn(`Найдена новая группа "${groupName}". Создание нового поста...`);
        const groupProducts = productData.filter(row => row[colGroupIndex] === groupName);
        const messageText = formatProductPost(groupProducts, productColMap, groupName);
        
        const newPostResponse = sendTelegramMessage2(CONFIG.TG_CHAT_ID, messageText);
        if (newPostResponse && newPostResponse.ok) {
          const newMessageId = newPostResponse.result.message_id;
          console.log(`Новый пост для группы "${groupName}" создан с message_id: ${newMessageId}.`);
          appendRowWithRetry(directorySheet, [groupName, newMessageId, "Активен"]);
        }
      }
    });
  
    console.log("--- Обработка постов с товарами завершена ---");
  }
  
  function processNavigationPost(spreadsheet=SpreadsheetApp.getActiveSpreadsheet()) {
      console.log("--- Начало обработки навигационного поста (безопасный режим) ---");
     
      const settingsSheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAMES.SETTINGS);
      const directorySheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAMES.DIRECTORY);
      
      const directoryData = directorySheet.getDataRange().getValues();
      const directoryHeaders = directoryData.shift() || [];
      const directoryColMap = getColumnIndexMap(directoryHeaders);
      
      const activePosts = directoryData
        .filter(row => row[directoryColMap[CONFIG.COLUMN_NAMES.DIR_STATUS]] === "Активен")
        .map(row => ({
            groupName: row[directoryColMap[CONFIG.COLUMN_NAMES.DIR_GROUP]],
            messageId: row[directoryColMap[CONFIG.COLUMN_NAMES.DIR_MESSAGE_ID]]
        }))
        // =================================================================
        // ВОТ ЭТО ИЗМЕНЕНИЕ: Добавляем сортировку по названию группы
        // =================================================================
        .sort((a, b) => a.groupName.localeCompare(b.groupName));
        // =================================================================
  
      if (activePosts.length === 0) {
          console.warn("Нет активных постов для создания навигации. Пропускаем шаг.");
          // Важно: если активных постов нет, нужно все равно удалить старый навигационный пост
          const oldNavMessageId = getSetting(settingsSheet, "nav_message_id");
          if (oldNavMessageId) {
              console.log(`Активных постов нет. Удаление старого навигационного поста с ID: ${oldNavMessageId}...`);
              unpinTelegramMessage(CONFIG.TG_CHAT_ID, oldNavMessageId);
              deleteTelegramMessage(CONFIG.TG_CHAT_ID, oldNavMessageId);
              setSetting(settingsSheet, "nav_message_id", null); // Очищаем настройку
          }
          return;
      }
  
      const { text, reply_markup } = formatNavigationPost(activePosts);
      const newPostResponse = sendTelegramMessage2(CONFIG.TG_CHAT_ID, text, reply_markup);
      
      if (!newPostResponse || !newPostResponse.ok) {
          console.error("Не удалось создать новый навигационный пост. Прерывание операции.");
          return;
      }
  
      const newNavMessageId = newPostResponse.result.message_id;
      console.log(`Новый навигационный пост успешно создан с ID: ${newNavMessageId}.`);
      
      const pinResponse = pinTelegramMessage(CONFIG.TG_CHAT_ID, newNavMessageId);
      if (!pinResponse || !pinResponse.ok) {
          console.error(`Не удалось закрепить пост ${newNavMessageId}. Старый пост не будет удален.`);
          setSetting(settingsSheet, "nav_message_id", newNavMessageId);
          return;
      }
  
      console.log(`Пост ${newNavMessageId} успешно закреплен.`);
      
      const oldNavMessageId = getSetting(settingsSheet, "nav_message_id");
      if (oldNavMessageId && oldNavMessageId != newNavMessageId) {
          console.log(`Удаление старого навигационного поста с ID: ${oldNavMessageId}...`);
          unpinTelegramMessage(CONFIG.TG_CHAT_ID, oldNavMessageId);
          deleteTelegramMessage(CONFIG.TG_CHAT_ID, oldNavMessageId);
      }
      
      setSetting(settingsSheet, "nav_message_id", newNavMessageId);
      console.log(`ID нового навигационного поста (${newNavMessageId}) сохранен в настройках.`);
      console.log("--- Обработка навигационного поста завершена ---");
  }
  /**
   * =================================================================
   * БЛОК 3: ФОРМАТИРОВАНИЕ СООБЩЕНИЙ
   * =================================================================
   */
  
  function formatProductPost(rows, colMap, groupName) {
    let messageText = CONFIG.MESSAGE_TEMPLATES.HEADER.replace('{groupName}', groupName);
    const colPriceIndex = colMap[CONFIG.COLUMN_NAMES.PRICE];
    
    const groupedByCategory = {};
    rows.forEach(row => {
      const category = row[colMap[CONFIG.COLUMN_NAMES.CATEGORY]] || "Прочее";
      if (!groupedByCategory[category]) {
        groupedByCategory[category] = [];
      }
      groupedByCategory[category].push(row);
    });
  
    for (const category in groupedByCategory) {
      let itemsInCategory = groupedByCategory[category];
      
      // ИЗМЕНЕНИЕ: 1. Фильтруем товары без цены, если флаг SHOW_ITEMS_WITHOUT_PRICE установлен в false
      if (CONFIG.SHOW_ITEMS_WITHOUT_PRICE === false) {
        itemsInCategory = itemsInCategory.filter(row => {
          const price = parseInt(row[colPriceIndex], 10);
          return !isNaN(price); // Оставляем только те строки, где цена является числом
        });
      }
  
      // ИЗМЕНЕНИЕ: 2. Если после фильтрации в подкатегории не осталось товаров, пропускаем ее
      if (itemsInCategory.length === 0) {
        continue; // Переходим к следующей категории
      }
  
      messageText += `\n<b>${category}</b>\n`;
      
      // Сортировка оставшихся товаров по цене
      itemsInCategory.sort((a, b) => {
        const priceA = parseInt(a[colPriceIndex], 10);
        const priceB = parseInt(b[colPriceIndex], 10);
        if (isNaN(priceA)) return 1;
        if (isNaN(priceB)) return -1;
        return priceA - priceB;
      });
      
      itemsInCategory.forEach(row => {
        const name = row[colMap[CONFIG.COLUMN_NAMES.NAME]];
        const rawPrice = parseInt(row[colPriceIndex], 10);
        let finalPrice = rawPrice;
  
        if (!isNaN(rawPrice)) {
          if (rawPrice <= CONFIG.PRICE_MARKUP_THRESHOLD) {
            finalPrice = rawPrice + CONFIG.PRICE_MARKUP_LOW;
          } else {
            finalPrice = rawPrice + CONFIG.PRICE_MARKUP;
          }
          finalPrice = Math.ceil(finalPrice / 500) * 500;
        }
        
        const formattedPrice = isNaN(finalPrice) ? 'по запросу' : `${finalPrice.toLocaleString('ru-RU')}₽`;
        const flag = row[colMap[CONFIG.COLUMN_NAMES.FLAG]] || "";
        
        messageText += `${flag} ${name} – ${formattedPrice}\n`;
      });
    }
  
    messageText += CONFIG.MESSAGE_TEMPLATES.FOOTER;
    return messageText;
  }
  
  function formatNavigationPost(activePosts) {
    const text = CONFIG.MESSAGE_TEMPLATES.NAV_HEADER;
    const buttons = activePosts.map(post => {
      const chatIdNum = CONFIG.TG_CHAT_ID.toString().startsWith('-100') 
          ? CONFIG.TG_CHAT_ID.toString().substring(4) 
          : CONFIG.TG_CHAT_ID.replace('@', '');
      const url = `https://t.me/${chatIdNum}/${post.messageId}`;
      return [{ text: post.groupName, url: url }];
    });
  
    return { text: text, reply_markup: { inline_keyboard: buttons } };
  }
  
  
  /**
   * =================================================================
   * БЛОК 4: ВЗАИМОДЕЙСТВИЕ С API TELEGRAM (УЛУЧШЕННАЯ ВЕРСИЯ)
   * =================================================================
   */
  
  function apiRequest(method, payload) {
    const MAX_RETRIES = 5;
    for (let i = 0; i < MAX_RETRIES; i++) {
      const options = { 'method': 'post', 'contentType': 'application/json', 'payload': JSON.stringify(payload), 'muteHttpExceptions': true };
      try {
        const response = UrlFetchApp.fetch(TG_BASE_URL + method, options);
        const responseData = JSON.parse(response.getContentText());
        if (responseData.ok === false && responseData.description.includes('Too Many Requests')) {
          const matches = responseData.description.match(/retry after (\d+)/);
          if (matches && matches[1]) {
            const waitSeconds = parseInt(matches[1], 10);
            console.warn(`Превышен лимит запросов. Ожидание ${waitSeconds} сек. Попытка ${i + 1} из ${MAX_RETRIES}...`);
            Utilities.sleep((waitSeconds + 1) * 1000);
            continue;
          }
        }
        if (responseData.ok === false) {
          console.error(`Ошибка API Telegram в методе ${method}: ${responseData.description}. Payload: ${JSON.stringify(payload)}`);
        }
        return responseData;
      } catch (e) {
        console.error(`Сетевая ошибка при вызове метода ${method}: ${e.toString()}`);
        return null;
      }
    }
    console.error(`Не удалось выполнить запрос к методу ${method} после ${MAX_RETRIES} попыток.`);
    return null;
  }
  
  function sendTelegramMessage2(chatId, text, reply_markup = null) {
    console.log(`Отправка нового сообщения в чат ${chatId}...`);
    const payload = { chat_id: chatId, text: text, parse_mode: 'HTML' };
    if (reply_markup) payload.reply_markup = reply_markup;
    return apiRequest('sendMessage', payload);
  }
  
  function editTelegramMessage(chatId, messageId, text) {
    console.log(`Редактирование сообщения ${messageId} в чате ${chatId}...`);
    return apiRequest('editMessageText', { chat_id: chatId, message_id: messageId, text: text, parse_mode: 'HTML' });
  }
  
  function deleteTelegramMessage(chatId, messageId) {
    console.log(`Удаление сообщения ${messageId} из чата ${chatId}...`);
    return apiRequest('deleteMessage', { chat_id: chatId, message_id: messageId });
  }
  
  function pinTelegramMessage(chatId, messageId) {
    console.log(`Закрепление сообщения ${messageId} в чате ${chatId}...`);
    return apiRequest('pinChatMessage', { chat_id: chatId, message_id: messageId, disable_notification: true });
  }
  
  function unpinTelegramMessage(chatId, messageId) {
    console.log(`Открепление сообщения ${messageId} из чата ${chatId}...`);
    return apiRequest('unpinChatMessage', { chat_id: chatId, message_id: messageId });
  }
  
  /**
   * =================================================================
   * БЛОК 5: РАБОТА С НАСТРОЙКАМИ
   * =================================================================
   */
   
  function getSetting(settingsSheet, key) {
      const data = settingsSheet.getRange("A:B").getValues();
      for (let i = 0; i < data.length; i++) {
          if (data[i][0] === key) return data[i][1];
      }
      return null;
  }
  
  function setSetting(settingsSheet, key, value) {
      const data = settingsSheet.getRange("A:B").getValues();
      let found = false;
      for (let i = 0; i < data.length; i++) {
          if (data[i][0] === key) {
              settingsSheet.getRange(i + 1, 2).setValue(value);
              found = true;
              break;
          }
      }
      if (!found) settingsSheet.appendRow([key, value]);
  }